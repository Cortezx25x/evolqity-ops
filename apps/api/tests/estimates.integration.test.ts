import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type { OrganizationRole } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';

interface TenantIdentity {
  organizationId: string;
  membershipId: string;
  accessToken: string;
  role: OrganizationRole;
}

interface EstimateResponse {
  id: string;
  number: number;
  status: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  sentAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  createdBy: { membershipId: string };
  items: Array<{
    id: string;
    sortOrder: number;
    quantity: string;
    unitPrice: string;
    subtotal: string;
    discountAmount: string;
    taxableAmount: string;
    taxAmount: string;
    total: string;
  }>;
}

const baseItem = {
  type: 'LABOR',
  description: 'Labor',
  quantity: '2.000',
  unitPrice: '100.00',
  discountPercent: '10.00',
  taxPercent: '13.00',
} as const;

function requestHeaders(tenant: TenantIdentity, includeContext = true) {
  return {
    authorization: `Bearer ${tenant.accessToken}`,
    ...(includeContext
      ? { 'x-organization-id': tenant.organizationId }
      : {}),
  };
}

describe('estimates API', () => {
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
    const asset = await prisma.asset.create({
      data: {
        organizationId: tenant.organizationId,
        customerId: customer.id,
        name: unique('Asset'),
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
          assetId: asset.id,
          number: organization.nextWorkOrderNumber - 1,
          title: unique('Work Order'),
          createdByMembershipId: tenant.membershipId,
        },
        select: { id: true },
      });
    });
  }

  async function postEstimate(
    tenant: TenantIdentity,
    workOrderId: string,
    body: Record<string, unknown> = { currency: 'USD' },
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrderId}/estimates`,
      headers: requestHeaders(tenant),
      payload: body,
    });
  }

  async function mustCreateEstimate(
    tenant: TenantIdentity,
    workOrderId: string,
    body: Record<string, unknown> = {
      currency: 'USD',
      items: [baseItem],
    },
  ): Promise<EstimateResponse> {
    const response = await postEstimate(tenant, workOrderId, body);
    expect(response.statusCode).toBe(201);
    return response.json<EstimateResponse>();
  }

  async function changeStatus(
    tenant: TenantIdentity,
    estimateId: string,
    status: 'SENT' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/estimates/${estimateId}/status`,
      headers: requestHeaders(tenant),
      payload: { status },
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

  describe('create and numbering', () => {
    it.each(['OWNER', 'ADMIN', 'MEMBER'] as const)(
      'allows %s to create a DRAFT',
      async (role) => {
        const tenant = await createTenant(`create-${role}`, role);
        const workOrder = await createWorkOrder(tenant);
        const response = await postEstimate(tenant, workOrder.id, {
          currency: 'usd',
        });
        const estimate = response.json<EstimateResponse>();

        expect(response.statusCode).toBe(201);
        expect(estimate).toMatchObject({
          number: 1,
          status: 'DRAFT',
          currency: 'USD',
          subtotal: '0.00',
          discountTotal: '0.00',
          taxTotal: '0.00',
          total: '0.00',
          createdBy: { membershipId: tenant.membershipId },
          items: [],
        });
        expect(estimate).not.toHaveProperty('organizationId');
        expect(estimate).not.toHaveProperty('nextItemOrder');
      },
    );

    it('allocates consecutive numbers independently per tenant', async () => {
      const tenantA = await createTenant('numbers-a');
      const tenantB = await createTenant('numbers-b');
      const workOrderA = await createWorkOrder(tenantA);
      const workOrderB = await createWorkOrder(tenantB);

      const firstA = await mustCreateEstimate(tenantA, workOrderA.id);
      const secondA = await mustCreateEstimate(tenantA, workOrderA.id);
      const firstB = await mustCreateEstimate(tenantB, workOrderB.id);

      expect([firstA.number, secondA.number]).toEqual([1, 2]);
      expect(firstB.number).toBe(1);
    });

    it('allocates unique consecutive numbers under concurrency', async () => {
      const tenant = await createTenant('number-concurrency');
      const workOrder = await createWorkOrder(tenant);
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          postEstimate(tenant, workOrder.id, { currency: 'EUR' }),
        ),
      );
      const numbers = responses
        .map((response) => {
          expect(response.statusCode).toBe(201);
          return response.json<EstimateResponse>().number;
        })
        .sort((left, right) => left - right);

      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }, 60_000);

    it('rolls back the organization counter when create fails', async () => {
      const tenant = await createTenant('number-rollback');
      const workOrder = await createWorkOrder(tenant);
      await mustCreateEstimate(tenant, workOrder.id);
      await prisma.organization.update({
        where: { id: tenant.organizationId },
        data: { nextEstimateNumber: 1 },
      });
      const before = await prisma.organization.findUniqueOrThrow({
        where: { id: tenant.organizationId },
        select: { nextEstimateNumber: true },
      });

      const response = await postEstimate(tenant, workOrder.id);
      const after = await prisma.organization.findUniqueOrThrow({
        where: { id: tenant.organizationId },
        select: { nextEstimateNumber: true },
      });

      expect(response.statusCode).toBe(500);
      expect(after.nextEstimateNumber).toBe(before.nextEstimateNumber);
      await expect(
        prisma.estimate.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).resolves.toBe(1);
    });

    it('rejects foreign and closed Work Orders', async () => {
      const tenantA = await createTenant('create-scope-a');
      const tenantB = await createTenant('create-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const foreign = await postEstimate(tenantB, workOrderA.id);
      await prisma.workOrder.update({
        where: { id: workOrderA.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const closed = await postEstimate(tenantA, workOrderA.id);

      expect(foreign.statusCode).toBe(404);
      expect(foreign.json()).toEqual({ message: 'Work order not found' });
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toEqual({ message: 'Work order is closed' });
    });

    it.each([
      'organizationId',
      'workOrderId',
      'number',
      'status',
      'subtotal',
      'createdByMembershipId',
      'nextItemOrder',
    ])('rejects server-controlled create field %s', async (field) => {
      const tenant = await createTenant(`strict-${field}`);
      const workOrder = await createWorkOrder(tenant);
      const response = await postEstimate(tenant, workOrder.id, {
        currency: 'USD',
        [field]: field === 'number' ? 99 : 'forbidden',
      });

      expect(response.statusCode).toBe(400);
    });

    it('creates initial items and exact totals in one transaction', async () => {
      const tenant = await createTenant('initial-items');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id, {
        currency: 'crc',
        items: [
          baseItem,
          {
            type: 'PART',
            description: 'Part',
            quantity: '0.500',
            unitPrice: '50.00',
            discountPercent: '0.00',
            taxPercent: '0.00',
          },
        ],
      });
      const stored = await prisma.estimate.findUniqueOrThrow({
        where: { id: estimate.id },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      expect(estimate.currency).toBe('CRC');
      expect(estimate.items.map((item) => item.sortOrder)).toEqual([1, 2]);
      expect(estimate).toMatchObject({
        subtotal: '225.00',
        discountTotal: '20.00',
        taxTotal: '23.40',
        total: '228.40',
      });
      expect(stored.total.toString()).toBe('228.4');
      expect(stored.items[0]?.total.toString()).toBe('203.4');
      expect(stored.nextItemOrder).toBe(3);
    });
  });

  describe('list, detail, and draft updates', () => {
    it('filters and paginates with a tenant-scoped total', async () => {
      const tenantA = await createTenant('list-a');
      const tenantB = await createTenant('list-b');
      const workOrderA = await createWorkOrder(tenantA);
      const workOrderB = await createWorkOrder(tenantB);
      const first = await mustCreateEstimate(tenantA, workOrderA.id);
      await mustCreateEstimate(tenantA, workOrderA.id);
      await mustCreateEstimate(tenantB, workOrderB.id);
      await changeStatus(tenantA, first.id, 'SENT');
      const response = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${workOrderA.id}/estimates?status=DRAFT&page=1&limit=1`,
        headers: requestHeaders(tenantA),
      });
      const body = response.json<{
        data: Array<Record<string, unknown>>;
        pagination: { total: number; totalPages: number };
      }>();

      expect(response.statusCode).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ status: 'DRAFT' });
      expect(body.data[0]).not.toHaveProperty('items');
      expect(body.pagination).toMatchObject({ total: 1, totalPages: 1 });
    });

    it('returns full safe detail ordered by item sortOrder', async () => {
      const tenant = await createTenant('detail');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id, {
        currency: 'USD',
        items: [
          baseItem,
          { ...baseItem, description: 'Second', quantity: '1.000' },
        ],
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/estimates/${estimate.id}`,
        headers: requestHeaders(tenant),
      });
      const body = response.json<EstimateResponse & Record<string, unknown>>();

      expect(response.statusCode).toBe(200);
      expect(body.items.map((item) => item.sortOrder)).toEqual([1, 2]);
      expect(body).toHaveProperty('workOrder.customer');
      expect(body).toHaveProperty('workOrder.asset');
      expect(body).not.toHaveProperty('organizationId');
      expect(body).not.toHaveProperty('nextItemOrder');
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      expect(JSON.stringify(body)).not.toContain('tokenHash');
      expect(body.total).toMatch(/^\d+\.\d{2}$/);
    });

    it('hides detail and update cross-tenant', async () => {
      const tenantA = await createTenant('detail-scope-a');
      const tenantB = await createTenant('detail-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const estimate = await mustCreateEstimate(tenantA, workOrderA.id);

      for (const method of ['GET', 'PATCH'] as const) {
        const response = await app.inject({
          method,
          url: `/api/estimates/${estimate.id}`,
          headers: requestHeaders(tenantB),
          ...(method === 'PATCH' ? { payload: { notes: 'Hidden' } } : {}),
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ message: 'Estimate not found' });
      }
    });

    it('updates DRAFT fields but rejects server fields and SENT changes', async () => {
      const tenant = await createTenant('patch');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id);
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/estimates/${estimate.id}`,
        headers: requestHeaders(tenant),
        payload: {
          currency: 'eur',
          notes: ' Updated ',
          validUntil: '2030-01-01T00:00:00.000Z',
        },
      });
      const strict = await app.inject({
        method: 'PATCH',
        url: `/api/estimates/${estimate.id}`,
        headers: requestHeaders(tenant),
        payload: { total: '0.00' },
      });
      await changeStatus(tenant, estimate.id, 'SENT');
      const locked = await app.inject({
        method: 'PATCH',
        url: `/api/estimates/${estimate.id}`,
        headers: requestHeaders(tenant),
        payload: { notes: 'Blocked' },
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        currency: 'EUR',
        notes: 'Updated',
      });
      expect(strict.statusCode).toBe(400);
      expect(locked.statusCode).toBe(409);
      expect(locked.json()).toEqual({ message: 'Estimate is locked' });
    });
  });

  describe('item mutations and totals', () => {
    it('adds, updates, and deletes items with consistent DB totals', async () => {
      const tenant = await createTenant('item-crud');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id, {
        currency: 'USD',
        items: [],
      });
      const added = await app.inject({
        method: 'POST',
        url: `/api/estimates/${estimate.id}/items`,
        headers: requestHeaders(tenant),
        payload: baseItem,
      });
      const item = added.json<EstimateResponse['items'][number]>();
      let stored = await prisma.estimate.findUniqueOrThrow({
        where: { id: estimate.id },
      });

      expect(added.statusCode).toBe(201);
      expect(item).toMatchObject({
        subtotal: '200.00',
        discountAmount: '20.00',
        taxAmount: '23.40',
        total: '203.40',
      });
      expect(stored.total.toString()).toBe('203.4');

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/estimates/${estimate.id}/items/${item.id}`,
        headers: requestHeaders(tenant),
        payload: {
          quantity: '0.100',
          unitPrice: '0.20',
          discountPercent: '0.00',
          taxPercent: '0.00',
        },
      });
      stored = await prisma.estimate.findUniqueOrThrow({
        where: { id: estimate.id },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        quantity: '0.100',
        subtotal: '0.02',
        total: '0.02',
      });
      expect(stored.total.toString()).toBe('0.02');

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/estimates/${estimate.id}/items/${item.id}`,
        headers: requestHeaders(tenant),
      });
      stored = await prisma.estimate.findUniqueOrThrow({
        where: { id: estimate.id },
      });
      expect(deleted.statusCode).toBe(204);
      expect(stored.total.toString()).toBe('0');
      await expect(
        prisma.estimateItem.count({ where: { estimateId: estimate.id } }),
      ).resolves.toBe(0);
    });

    it('rejects item IDs from another Estimate', async () => {
      const tenant = await createTenant('item-scope');
      const workOrder = await createWorkOrder(tenant);
      const first = await mustCreateEstimate(tenant, workOrder.id);
      const second = await mustCreateEstimate(tenant, workOrder.id);
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/estimates/${second.id}/items/${first.items[0]!.id}`,
        headers: requestHeaders(tenant),
        payload: { description: 'Wrong estimate' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        message: 'Estimate item not found',
      });
    });

    it('assigns unique consecutive item sortOrder under concurrency', async () => {
      const tenant = await createTenant('item-concurrency');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id, {
        currency: 'USD',
        items: [],
      });
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: `/api/estimates/${estimate.id}/items`,
            headers: requestHeaders(tenant),
            payload: {
              ...baseItem,
              description: `Concurrent ${index}`,
            },
          }),
        ),
      );
      const items = await prisma.estimateItem.findMany({
        where: { estimateId: estimate.id },
        orderBy: { sortOrder: 'asc' },
      });

      expect(responses.every((response) => response.statusCode === 201)).toBe(
        true,
      );
      expect(items.map((item) => item.sortOrder)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      const stored = await prisma.estimate.findUniqueOrThrow({
        where: { id: estimate.id },
      });
      expect(stored.total.toString()).toBe('1627.2');
    }, 60_000);
  });

  describe('status workflow and lifecycle', () => {
    it('blocks sending an Estimate without items', async () => {
      const tenant = await createTenant('send-empty');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id, {
        currency: 'USD',
        items: [],
      });
      const response = await changeStatus(tenant, estimate.id, 'SENT');

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: 'Estimate has no items' });
    });

    it('forbids MEMBER status changes', async () => {
      const tenant = await createTenant('status-member', 'MEMBER');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id);
      const response = await changeStatus(tenant, estimate.id, 'SENT');

      expect(response.statusCode).toBe(403);
    });

    it.each(['OWNER', 'ADMIN'] as const)(
      'allows %s to send and approve with idempotent timestamps',
      async (role) => {
        const tenant = await createTenant(`status-${role}`, role);
        const workOrder = await createWorkOrder(tenant);
        const estimate = await mustCreateEstimate(tenant, workOrder.id);
        const sent = await changeStatus(tenant, estimate.id, 'SENT');
        const firstSentAt = sent.json<EstimateResponse>().sentAt;
        const sentAgain = await changeStatus(tenant, estimate.id, 'SENT');
        const approved = await changeStatus(
          tenant,
          estimate.id,
          'APPROVED',
        );
        const firstApprovedAt =
          approved.json<EstimateResponse>().approvedAt;
        const approvedAgain = await changeStatus(
          tenant,
          estimate.id,
          'APPROVED',
        );

        expect(sent.statusCode).toBe(200);
        expect(firstSentAt).not.toBeNull();
        expect(sentAgain.json<EstimateResponse>().sentAt).toBe(firstSentAt);
        expect(approved.statusCode).toBe(200);
        expect(firstApprovedAt).not.toBeNull();
        expect(approvedAgain.json<EstimateResponse>().approvedAt).toBe(
          firstApprovedAt,
        );
      },
    );

    it(
      'supports rejection and cancellation, and rejects terminal transitions',
      async () => {
        const tenant = await createTenant('status-terminal');
        const workOrder = await createWorkOrder(tenant);
        const rejected = await mustCreateEstimate(tenant, workOrder.id);
        await changeStatus(tenant, rejected.id, 'SENT');
        const rejectResponse = await changeStatus(
          tenant,
          rejected.id,
          'REJECTED',
        );
        const invalid = await changeStatus(
          tenant,
          rejected.id,
          'APPROVED',
        );
        const draftCancelled = await mustCreateEstimate(
          tenant,
          workOrder.id,
        );
        const cancelDraft = await changeStatus(
          tenant,
          draftCancelled.id,
          'CANCELLED',
        );
        const sentCancelled = await mustCreateEstimate(
          tenant,
          workOrder.id,
        );
        await changeStatus(tenant, sentCancelled.id, 'SENT');
        const cancelSent = await changeStatus(
          tenant,
          sentCancelled.id,
          'CANCELLED',
        );

        expect(
          rejectResponse.json<EstimateResponse>().rejectedAt,
        ).not.toBeNull();
        expect(invalid.statusCode).toBe(409);
        expect(invalid.json()).toEqual({
          message: 'Invalid estimate status transition',
        });
        expect(
          cancelDraft.json<EstimateResponse>().cancelledAt,
        ).not.toBeNull();
        expect(
          cancelSent.json<EstimateResponse>().cancelledAt,
        ).not.toBeNull();
      },
      60_000,
    );

    it('keeps reads available but blocks mutations after WorkOrder closes', async () => {
      const tenant = await createTenant('closed-parent');
      const workOrder = await createWorkOrder(tenant);
      const estimate = await mustCreateEstimate(tenant, workOrder.id);
      await prisma.workOrder.update({
        where: { id: workOrder.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      const read = await app.inject({
        method: 'GET',
        url: `/api/estimates/${estimate.id}`,
        headers: requestHeaders(tenant),
      });
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/estimates/${estimate.id}`,
        headers: requestHeaders(tenant),
        payload: { notes: 'Blocked' },
      });
      const add = await app.inject({
        method: 'POST',
        url: `/api/estimates/${estimate.id}/items`,
        headers: requestHeaders(tenant),
        payload: baseItem,
      });
      const status = await changeStatus(tenant, estimate.id, 'SENT');

      expect(read.statusCode).toBe(200);
      for (const response of [patch, add, status]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: 'Work order is closed' });
      }
    });
  });

  describe('request security', () => {
    it('requires authentication and organization context', async () => {
      const tenant = await createTenant('security');
      const workOrder = await createWorkOrder(tenant);
      const anonymous = await app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/estimates`,
        payload: { currency: 'USD' },
      });
      const missingContext = await app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/estimates`,
        headers: requestHeaders(tenant, false),
        payload: { currency: 'USD' },
      });

      expect(anonymous.statusCode).toBe(401);
      expect(missingContext.statusCode).toBe(400);
    });

    it('rejects floats, excessive precision, NaN-like and calculated item fields', async () => {
      const tenant = await createTenant('decimal-input');
      const workOrder = await createWorkOrder(tenant);
      const invalidItems = [
        { ...baseItem, quantity: 0.1 },
        { ...baseItem, quantity: '1.0001' },
        { ...baseItem, unitPrice: 'NaN' },
        { ...baseItem, discountPercent: '100.01' },
        { ...baseItem, subtotal: '0.00' },
      ];

      for (const item of invalidItems) {
        const response = await postEstimate(tenant, workOrder.id, {
          currency: 'USD',
          items: [item],
        });
        expect(response.statusCode).toBe(400);
      }
      await expect(prisma.estimate.count()).resolves.toBe(0);
    });
  });
});
