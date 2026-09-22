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
  accessToken: string;
}

function headers(
  accessToken: string,
  organizationId?: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(organizationId === undefined
      ? {}
      : { 'x-organization-id': organizationId }),
  };
}

describe('platform admin API', () => {
  let app: FastifyInstance;
  let sequence = 0;

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
  }

  async function createUser(
    prefix: string,
    options: { platformAdmin?: boolean; role?: OrganizationRole } = {},
  ): Promise<TenantIdentity & { email: string }> {
    const email = `${unique(prefix)}@example.com`.toLowerCase();
    const user = await prisma.user.create({
      data: {
        email,
        ...(options.platformAdmin ? { platformRole: 'PLATFORM_ADMIN' } : {}),
      },
      select: { id: true },
    });
    const organization = await prisma.organization.create({
      data: { name: `${prefix} Organization`, slug: unique(prefix) },
      select: { id: true },
    });
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: options.role ?? 'OWNER',
        ...(options.role === 'MEMBER' ? {} : {}),
      },
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
      email,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
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

  it('allows PLATFORM_ADMIN to list organizations', async () => {
    const admin = await createUser('platform-admin', { platformAdmin: true });
    await createUser('tenant-a');
    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/organizations',
      headers: headers(admin.accessToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: unknown[] }>();
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it.each(['OWNER', 'ADMIN', 'MEMBER'] as const)(
    'denies %s without platform role',
    async (role) => {
      const tenant = await createUser(`role-${role.toLowerCase()}`, { role });
      const response = await app.inject({
        method: 'GET',
        url: '/api/platform/organizations',
        headers: headers(tenant.accessToken),
      });

      expect(response.statusCode).toBe(403);
    },
  );

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/organizations',
    });

    expect(response.statusCode).toBe(401);
  });

  it('deactivates and reactivates organization while preserving data', async () => {
    const admin = await createUser('lifecycle-admin', { platformAdmin: true });
    const tenant = await createUser('lifecycle-tenant');
    await prisma.customer.create({
      data: { organizationId: tenant.organizationId, name: 'Keep Me' },
    });

    const deactivate = await app.inject({
      method: 'POST',
      url: `/api/platform/organizations/${tenant.organizationId}/deactivate`,
      headers: headers(admin.accessToken),
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json()).toMatchObject({ active: false });

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: headers(tenant.accessToken, tenant.organizationId),
    });
    expect(blocked.statusCode).toBe(403);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: headers(tenant.accessToken),
    });
    expect(me.json()).toMatchObject({ organizations: [] });

    await expect(prisma.customer.count()).resolves.toBe(1);

    const reactivate = await app.inject({
      method: 'POST',
      url: `/api/platform/organizations/${tenant.organizationId}/activate`,
      headers: headers(admin.accessToken),
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json()).toMatchObject({ active: true });

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: headers(tenant.accessToken, tenant.organizationId),
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('does not grant tenant access to platform admin without membership', async () => {
    const admin = await createUser('no-membership-admin', {
      platformAdmin: true,
    });
    const tenant = await createUser('foreign-tenant');
    await prisma.organizationUser.deleteMany({ where: { userId: admin.userId } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: headers(admin.accessToken, tenant.organizationId),
    });

    expect(response.statusCode).toBe(403);
  });

  it('exposes platformRole on /me without setting it via register', async () => {
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `${unique('register')}@example.com`,
        password: 'ValidPassword123!',
        organizationName: 'Register Org',
        organizationSlug: unique('register-org'),
      },
    });
    expect(registerResponse.statusCode).toBe(201);
    expect(registerResponse.json()).toMatchObject({ platformRole: null });

    const admin = await createUser('me-admin', { platformAdmin: true });
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: headers(admin.accessToken),
    });
    expect(me.json()).toMatchObject({ platformRole: 'PLATFORM_ADMIN' });
  });

  it('allows PLATFORM_ADMIN to rename organization', async () => {
    const admin = await createUser('rename-admin', { platformAdmin: true });
    const tenant = await createUser('rename-tenant');
    const before = await prisma.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { id: true, active: true, name: true },
    });
    const membershipCountBefore = await prisma.organizationUser.count({
      where: { organizationId: tenant.organizationId },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/platform/organizations/${tenant.organizationId}`,
      headers: headers(admin.accessToken),
      payload: { name: 'Taller Renombrado' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: before.id,
      name: 'Taller Renombrado',
      active: before.active,
    });

    const membershipCountAfter = await prisma.organizationUser.count({
      where: { organizationId: tenant.organizationId },
    });
    expect(membershipCountAfter).toBe(membershipCountBefore);
  });

  it.each(['OWNER', 'ADMIN', 'MEMBER'] as const)(
    'denies %s PATCH on platform organization',
    async (role) => {
      const tenant = await createUser(`patch-${role.toLowerCase()}`, { role });
      const other = await createUser('patch-target');
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/platform/organizations/${other.organizationId}`,
        headers: headers(tenant.accessToken),
        payload: { name: 'Intento no autorizado' },
      });

      expect(response.statusCode).toBe(403);
    },
  );

  it('requires authentication to PATCH platform organization', async () => {
    const tenant = await createUser('patch-unauth');
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/platform/organizations/${tenant.organizationId}`,
      payload: { name: 'Sin sesión' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects empty or whitespace organization name', async () => {
    const admin = await createUser('rename-invalid', { platformAdmin: true });
    const tenant = await createUser('rename-invalid-target');
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/platform/organizations/${tenant.organizationId}`,
      headers: headers(admin.accessToken),
      payload: { name: '   ' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when renaming unknown organization', async () => {
    const admin = await createUser('rename-missing', { platformAdmin: true });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/platform/organizations/${randomUUID()}`,
      headers: headers(admin.accessToken),
      payload: { name: 'No existe' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lists renamed organization with updated name', async () => {
    const admin = await createUser('rename-list', { platformAdmin: true });
    const tenant = await createUser('rename-list-target');
    const newName = unique('Listed Name');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/platform/organizations/${tenant.organizationId}`,
      headers: headers(admin.accessToken),
      payload: { name: newName },
    });
    expect(patch.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/api/platform/organizations?search=${encodeURIComponent(newName)}`,
      headers: headers(admin.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      data: [expect.objectContaining({ id: tenant.organizationId, name: newName })],
    });
  });

  it('exposes renamed organization on /me for tenant member', async () => {
    const admin = await createUser('rename-me-admin', { platformAdmin: true });
    const tenant = await createUser('rename-me-tenant');
    const newName = 'Nombre visible en perfil';

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/platform/organizations/${tenant.organizationId}`,
      headers: headers(admin.accessToken),
      payload: { name: newName },
    });
    expect(patch.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: headers(tenant.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      organizations: [expect.objectContaining({ id: tenant.organizationId, name: newName })],
    });
  });
});
