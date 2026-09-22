import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type { OrganizationRole } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';
import { parsePublicEstimateToken } from '../src/modules/public-estimates/public-estimate.tokens.js';

interface TenantIdentity {
  organizationId: string;
  membershipId: string;
  accessToken: string;
  role: OrganizationRole;
}

const baseItem = {
  type: 'LABOR',
  description: 'Labor',
  quantity: '1.000',
  unitPrice: '100.00',
  discountPercent: '0.00',
  taxPercent: '0.00',
} as const;

function requestHeaders(tenant: TenantIdentity, includeContext = true) {
  return {
    authorization: `Bearer ${tenant.accessToken}`,
    ...(includeContext
      ? { 'x-organization-id': tenant.organizationId }
      : {}),
  };
}

function extractTokenFromPublicUrl(publicUrl: string): string {
  const marker = '#token=';
  const index = publicUrl.indexOf(marker);
  expect(index).toBeGreaterThan(-1);
  return publicUrl.slice(index + marker.length);
}

describe('public estimates API', () => {
  let app: FastifyInstance;
  let sequence = 0;

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
  }

  async function createTenant(
    prefix: string,
    role: OrganizationRole = 'OWNER',
  ): Promise<TenantIdentity> {
    const user = await prisma.user.create({
      data: {
        email: `${unique(prefix)}@example.com`,
        firstName: prefix,
        lastName: 'Tester',
      },
      select: { id: true },
    });
    const organization = await prisma.organization.create({
      data: { name: `${prefix} Organization`, slug: unique(prefix) },
      select: { id: true },
    });
    const membership = await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role,
      },
      select: { id: true },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });

    return {
      organizationId: organization.id,
      membershipId: membership.id,
      role,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createWorkOrder(tenant: TenantIdentity) {
    const customer = await prisma.customer.create({
      data: {
        organizationId: tenant.organizationId,
        name: unique('Customer'),
      },
      select: { id: true },
    });

    return prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.update({
        where: { id: tenant.organizationId },
        data: { nextWorkOrderNumber: { increment: 1 } },
        select: { nextWorkOrderNumber: true },
      });

      return transaction.workOrder.create({
        data: {
          organizationId: tenant.organizationId,
          customerId: customer.id,
          number: organization.nextWorkOrderNumber - 1,
          title: unique('Work Order'),
          createdByMembershipId: tenant.membershipId,
        },
        select: { id: true },
      });
    });
  }

  async function createSentEstimate(tenant: TenantIdentity) {
    const workOrder = await createWorkOrder(tenant);
    const createResponse = await app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/estimates`,
      headers: requestHeaders(tenant),
      payload: { currency: 'USD', items: [baseItem] },
    });
    expect(createResponse.statusCode).toBe(201);
    const estimate = createResponse.json<{ id: string }>();
    const sentResponse = await app.inject({
      method: 'POST',
      url: `/api/estimates/${estimate.id}/status`,
      headers: requestHeaders(tenant),
      payload: { status: 'SENT' },
    });
    expect(sentResponse.statusCode).toBe(200);
    return { estimateId: estimate.id, workOrderId: workOrder.id };
  }

  async function issuePublicAccess(tenant: TenantIdentity, estimateId: string) {
    return app.inject({
      method: 'POST',
      url: `/api/estimates/${estimateId}/public-access`,
      headers: requestHeaders(tenant),
    });
  }

  beforeAll(async () => {
    const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
    if (!databaseName.endsWith('_test')) {
      throw new Error(
        'Integration tests refuse to run unless DATABASE_URL targets a *_test database.',
      );
    }

    app = await buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.estimatePublicToken.deleteMany();
    await prisma.media.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.organizationUser.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('issues public access for SENT estimates and never stores raw secrets', async () => {
    const tenant = await createTenant('issue');
    const { estimateId } = await createSentEstimate(tenant);
    const response = await issuePublicAccess(tenant, estimateId);

    expect(response.statusCode).toBe(201);
    const body = response.json<{ publicUrl: string; expiresAt: string }>();
    const token = extractTokenFromPublicUrl(body.publicUrl);
    const parsed = parsePublicEstimateToken(token);
    expect(parsed).not.toBeNull();

    const stored = await prisma.estimatePublicToken.findMany({
      select: { id: true, secretHash: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(parsed?.tokenId);
    expect(JSON.stringify(stored)).not.toContain(parsed?.secret);
    expect(body.publicUrl).toBe(`${env.PUBLIC_ESTIMATE_BASE_URL}#token=${token}`);
  });

  it('reissues after an expired but non-revoked token by revoking it first', async () => {
    const tenant = await createTenant('reissue-expired');
    const { estimateId } = await createSentEstimate(tenant);
    const firstIssue = await issuePublicAccess(tenant, estimateId);
    const firstToken = extractTokenFromPublicUrl(
      firstIssue.json<{ publicUrl: string }>().publicUrl,
    );
    const parsedFirst = parsePublicEstimateToken(firstToken);
    expect(parsedFirst).not.toBeNull();

    await prisma.estimatePublicToken.update({
      where: { id: parsedFirst!.tokenId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const secondIssue = await issuePublicAccess(tenant, estimateId);
    expect(secondIssue.statusCode).toBe(201);

    const oldToken = await prisma.estimatePublicToken.findUniqueOrThrow({
      where: { id: parsedFirst!.tokenId },
    });
    expect(oldToken.revokedAt).not.toBeNull();
    expect(oldToken.revokedReason).toBe('rotated');

    const activeCount = await prisma.estimatePublicToken.count({
      where: { estimateId, revokedAt: null },
    });
    expect(activeCount).toBe(1);

    const activeTokens = await prisma.estimatePublicToken.findMany({
      where: { estimateId, revokedAt: null },
      select: { id: true },
    });
    expect(activeTokens[0]?.id).not.toBe(parsedFirst!.tokenId);
  });

  it('returns allowlisted public view data and ignores X-Organization-Id', async () => {
    const tenant = await createTenant('view');
    const other = await createTenant('view-other');
    const { estimateId } = await createSentEstimate(tenant);
    const issue = await issuePublicAccess(tenant, estimateId);
    const token = extractTokenFromPublicUrl(
      issue.json<{ publicUrl: string }>().publicUrl,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/public/estimates/view',
      headers: {
        authorization: `Estimate ${token}`,
        'x-organization-id': other.organizationId,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body).toHaveProperty('organization', { name: expect.any(String) });
    expect(body).toHaveProperty('estimate');
    expect(body).toHaveProperty('workOrder');
    expect(body).toHaveProperty('items');
    expect(JSON.stringify(body)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(body.estimate).toMatchObject({
      canRespond: true,
      blockedReason: null,
      subtotal: expect.stringMatching(/^\d+\.\d{2}$/),
    });
  });

  it('rejects organizationId in public decision bodies', async () => {
    const tenant = await createTenant('reject-org-body');
    const { estimateId } = await createSentEstimate(tenant);
    const issue = await issuePublicAccess(tenant, estimateId);
    const token = extractTokenFromPublicUrl(
      issue.json<{ publicUrl: string }>().publicUrl,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/public/estimates/decision',
      headers: { authorization: `Estimate ${token}` },
      payload: {
        decision: 'APPROVED',
        responderName: 'Customer',
        organizationId: tenant.organizationId,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('approves a SENT estimate publicly and supports same-decision retry', async () => {
    const tenant = await createTenant('approve');
    const { estimateId } = await createSentEstimate(tenant);
    const issue = await issuePublicAccess(tenant, estimateId);
    const token = extractTokenFromPublicUrl(
      issue.json<{ publicUrl: string }>().publicUrl,
    );

    const approve = await app.inject({
      method: 'POST',
      url: '/api/public/estimates/decision',
      headers: { authorization: `Estimate ${token}` },
      payload: { decision: 'APPROVED', responderName: 'Customer Name' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().estimate.status).toBe('APPROVED');
    expect(approve.json().estimate.canRespond).toBe(false);

    const retry = await app.inject({
      method: 'POST',
      url: '/api/public/estimates/decision',
      headers: { authorization: `Estimate ${token}` },
      payload: { decision: 'APPROVED', responderName: 'Customer Name' },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().estimate.approvedAt).toBe(
      approve.json().estimate.approvedAt,
    );
  });

  it('returns 410 for an authenticated expired capability on view', async () => {
    const tenant = await createTenant('expired-view');
    const { estimateId } = await createSentEstimate(tenant);
    const issue = await issuePublicAccess(tenant, estimateId);
    const token = extractTokenFromPublicUrl(
      issue.json<{ publicUrl: string }>().publicUrl,
    );
    const parsed = parsePublicEstimateToken(token);
    await prisma.estimatePublicToken.update({
      where: { id: parsed!.tokenId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/public/estimates/view',
      headers: { authorization: `Estimate ${token}` },
    });

    expect(response.statusCode).toBe(410);
  });

  it('forbids MEMBER from issuing public access', async () => {
    const owner = await createTenant('member-issue-owner', 'OWNER');
    const memberUser = await prisma.user.create({
      data: {
        email: `${unique('member-issue')}@example.com`,
        firstName: 'Member',
        lastName: 'Tester',
      },
      select: { id: true },
    });
    const memberMembership = await prisma.organizationUser.create({
      data: {
        userId: memberUser.id,
        organizationId: owner.organizationId,
        role: 'MEMBER',
      },
      select: { id: true },
    });
    const memberSession = await prisma.authSession.create({
      data: {
        userId: memberUser.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const member: TenantIdentity = {
      organizationId: owner.organizationId,
      membershipId: memberMembership.id,
      role: 'MEMBER',
      accessToken: signAccessToken(app.jwt, {
        userId: memberUser.id,
        authSessionId: memberSession.id,
      }),
    };

    const { estimateId } = await createSentEstimate(owner);
    const response = await issuePublicAccess(member, estimateId);
    expect(response.statusCode).toBe(403);
  });
});
