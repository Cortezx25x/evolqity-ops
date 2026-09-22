import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type { OrganizationRole } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';

interface TenantIdentity {
  userId: string;
  organizationId: string;
  membershipId: string;
  accessToken: string;
  role: OrganizationRole;
}

describe('organization membership lifecycle', () => {
  let app: FastifyInstance;
  let sequence = 0;

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
  }

  function headers(identity: TenantIdentity, organizationId?: string) {
    return {
      authorization: `Bearer ${identity.accessToken}`,
      'x-organization-id': organizationId ?? identity.organizationId,
    };
  }

  async function createIdentity(
    prefix: string,
    role: OrganizationRole,
    organizationId?: string,
  ): Promise<TenantIdentity> {
    const user = await prisma.user.create({
      data: { email: `${unique(prefix)}@example.com` },
      select: { id: true },
    });

    const organization =
      organizationId === undefined
        ? await prisma.organization.create({
            data: {
              name: `${prefix} Organization`,
              slug: unique(`${prefix}-organization`),
            },
            select: { id: true },
          })
        : { id: organizationId };

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
      userId: user.id,
      organizationId: organization.id,
      membershipId: membership.id,
      role,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createMembership(
    organizationId: string,
    role: OrganizationRole = 'MEMBER',
  ) {
    const user = await prisma.user.create({
      data: { email: `${unique('employee')}@example.com` },
      select: { id: true, email: true },
    });
    const membership = await prisma.organizationUser.create({
      data: {
        organizationId,
        userId: user.id,
        role,
      },
      select: { id: true, role: true, active: true },
    });

    return { ...membership, userId: user.id, email: user.email };
  }

  async function lifecycleRequest(
    actor: TenantIdentity,
    membershipId: string,
    action: 'activate' | 'deactivate',
    urlOrganizationId = actor.organizationId,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/organizations/${urlOrganizationId}/members/${membershipId}/${action}`,
      headers: headers(actor, urlOrganizationId),
    });
  }

  async function createCustomer(organizationId: string) {
    return prisma.customer.create({
      data: {
        organizationId,
        name: unique('Customer'),
      },
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

  it('allows OWNER to deactivate and reactivate a MEMBER', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const member = await createMembership(owner.organizationId, 'MEMBER');

    const deactivated = await lifecycleRequest(
      owner,
      member.id,
      'deactivate',
    );
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json()).toMatchObject({
      id: member.id,
      active: false,
      role: 'MEMBER',
    });

    const reactivated = await lifecycleRequest(owner, member.id, 'activate');
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({ id: member.id, active: true });
  });

  it('allows OWNER to deactivate an ADMIN', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const admin = await createMembership(owner.organizationId, 'ADMIN');

    const response = await lifecycleRequest(owner, admin.id, 'deactivate');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: false, role: 'ADMIN' });
  });

  it('allows ADMIN to deactivate a MEMBER', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const admin = await createIdentity('admin', 'ADMIN', owner.organizationId);
    const member = await createMembership(owner.organizationId, 'MEMBER');

    const response = await lifecycleRequest(admin, member.id, 'deactivate');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: false });
  });

  it('forbids ADMIN from deactivating another ADMIN', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const admin = await createIdentity('admin', 'ADMIN', owner.organizationId);
    const otherAdmin = await createMembership(owner.organizationId, 'ADMIN');

    const response = await lifecycleRequest(
      admin,
      otherAdmin.id,
      'deactivate',
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      message: 'No tienes permisos para administrar este empleado.',
    });
  });

  it('forbids ADMIN from managing OWNER membership', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const admin = await createIdentity('admin', 'ADMIN', owner.organizationId);

    const response = await lifecycleRequest(
      admin,
      owner.membershipId,
      'deactivate',
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: 'No se puede realizar esta acción con este miembro.',
    });
  });

  it('forbids MEMBER from deactivating anyone', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const member = await createIdentity('member', 'MEMBER', owner.organizationId);
    const target = await createMembership(owner.organizationId, 'MEMBER');

    const response = await lifecycleRequest(member, target.id, 'deactivate');
    expect(response.statusCode).toBe(403);
  });

  it('forbids deactivating OWNER membership', async () => {
    const owner = await createIdentity('owner', 'OWNER');

    const response = await lifecycleRequest(
      owner,
      owner.membershipId,
      'deactivate',
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: 'No se puede realizar esta acción con este miembro.',
    });
  });

  it('forbids a user from deactivating their own membership', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const admin = await createIdentity('admin', 'ADMIN', owner.organizationId);

    const response = await lifecycleRequest(
      admin,
      admin.membershipId,
      'deactivate',
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: 'No se puede realizar esta acción con este miembro.',
    });
  });

  it('rejects cross-tenant membership lifecycle attempts', async () => {
    const ownerA = await createIdentity('owner-a', 'OWNER');
    const ownerB = await createIdentity('owner-b', 'OWNER');
    const foreignMember = await createMembership(ownerB.organizationId, 'MEMBER');

    const response = await lifecycleRequest(
      ownerA,
      foreignMember.id,
      'deactivate',
      ownerB.organizationId,
    );
    expect(response.statusCode).toBe(403);
    await expect(
      prisma.organizationUser.findUniqueOrThrow({ where: { id: foreignMember.id } }),
    ).resolves.toMatchObject({ active: true });
  });

  it('removes organization access while membership is inactive', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const employee = await createMembership(owner.organizationId, 'MEMBER');
    const session = await prisma.authSession.create({
      data: {
        userId: employee.userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const employeeToken = signAccessToken(app.jwt, {
      userId: employee.userId,
      authSessionId: session.id,
    });

    const before = await app.inject({
      method: 'GET',
      url: `/api/organizations/${owner.organizationId}/members`,
      headers: {
        authorization: `Bearer ${employeeToken}`,
        'x-organization-id': owner.organizationId,
      },
    });
    expect(before.statusCode).toBe(200);

    const deactivate = await lifecycleRequest(owner, employee.id, 'deactivate');
    expect(deactivate.statusCode).toBe(200);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/organizations/${owner.organizationId}/members`,
      headers: {
        authorization: `Bearer ${employeeToken}`,
        'x-organization-id': owner.organizationId,
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().organizations).toEqual([]);
  });

  it('restores organization access after reactivation', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const employee = await createMembership(owner.organizationId, 'MEMBER');
    const employeeUser = await prisma.user.findUniqueOrThrow({
      where: { id: employee.userId },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: employee.userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const employeeToken = signAccessToken(app.jwt, {
      userId: employee.userId,
      authSessionId: session.id,
    });

    expect(
      (await lifecycleRequest(owner, employee.id, 'deactivate')).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/organizations/${owner.organizationId}/members`,
          headers: {
            authorization: `Bearer ${employeeToken}`,
            'x-organization-id': owner.organizationId,
          },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (await lifecycleRequest(owner, employee.id, 'activate')).statusCode,
    ).toBe(200);

    const allowed = await app.inject({
      method: 'GET',
      url: `/api/organizations/${owner.organizationId}/members`,
      headers: {
        authorization: `Bearer ${employeeToken}`,
        'x-organization-id': owner.organizationId,
      },
    });
    expect(allowed.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(me.json().organizations).toContainEqual(
      expect.objectContaining({ id: owner.organizationId }),
    );
    expect(employeeUser.email).toBeDefined();
  });

  it('keeps historical work order assignment after deactivation', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const assignee = await createMembership(owner.organizationId, 'MEMBER');
    const customer = await createCustomer(owner.organizationId);

    const created = await app.inject({
      method: 'POST',
      url: '/api/work-orders',
      headers: headers(owner),
      payload: {
        customerId: customer.id,
        title: 'Historical assignment',
        assignedToMembershipId: assignee.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const workOrderId = created.json<{ id: string }>().id;

    expect(
      (await lifecycleRequest(owner, assignee.id, 'deactivate')).statusCode,
    ).toBe(200);

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/work-orders/${workOrderId}`,
      headers: headers(owner),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().assignedTo).toMatchObject({
      membershipId: assignee.id,
    });
  });

  it('leaves other organization memberships unaffected', async () => {
    const orgA = await createIdentity('org-a', 'OWNER');
    const orgB = await createIdentity('org-b', 'OWNER');

    const sharedUser = await prisma.user.create({
      data: { email: `${unique('shared')}@example.com` },
      select: { id: true },
    });
    const membershipA = await prisma.organizationUser.create({
      data: {
        organizationId: orgA.organizationId,
        userId: sharedUser.id,
        role: 'MEMBER',
      },
      select: { id: true },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: orgB.organizationId,
        userId: sharedUser.id,
        role: 'MEMBER',
      },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: sharedUser.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const token = signAccessToken(app.jwt, {
      userId: sharedUser.id,
      authSessionId: session.id,
    });

    expect(
      (await lifecycleRequest(orgA, membershipA.id, 'deactivate')).statusCode,
    ).toBe(200);

    const blockedInA = await app.inject({
      method: 'GET',
      url: `/api/organizations/${orgA.organizationId}/members`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': orgA.organizationId,
      },
    });
    expect(blockedInA.statusCode).toBe(403);

    const allowedInB = await app.inject({
      method: 'GET',
      url: `/api/organizations/${orgB.organizationId}/members`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': orgB.organizationId,
      },
    });
    expect(allowedInB.statusCode).toBe(200);
  });

  it('returns 404 for an unknown membership id', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const response = await lifecycleRequest(owner, randomUUID(), 'deactivate');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Miembro no encontrado.' });
  });
});
