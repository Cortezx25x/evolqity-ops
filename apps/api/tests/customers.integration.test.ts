import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type {
  CustomerType,
  OrganizationRole,
} from '../src/generated/prisma/enums.js';
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

describe('customers API', () => {
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
      data: { email: `${unique(prefix)}@example.com` },
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
        role,
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
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createCustomer(
    organizationId: string,
    overrides: {
      type?: CustomerType;
      name?: string;
      identification?: string;
      email?: string;
      phone?: string;
      notes?: string;
      active?: boolean;
    } = {},
  ) {
    return prisma.customer.create({
      data: {
        organizationId,
        name: unique('Customer'),
        ...overrides,
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

  describe('create', () => {
    it.each(['OWNER', 'ADMIN', 'MEMBER'] as const)(
      'allows %s to create a customer in its context',
      async (role) => {
        const tenant = await createTenant(role.toLowerCase(), role);
        const response = await app.inject({
          method: 'POST',
          url: '/api/customers',
          headers: headers(tenant.accessToken, tenant.organizationId),
          payload: {
            type: 'COMPANY',
            name: '  Example Company  ',
            email: '  CONTACT@EXAMPLE.COM ',
            phone: ' +506 2222-3333 ',
          },
        });
        const body = response.json<Record<string, unknown>>();

        expect(response.statusCode).toBe(201);
        expect(body).toMatchObject({
          type: 'COMPANY',
          name: 'Example Company',
          email: 'contact@example.com',
          phone: '+506 2222-3333',
          active: true,
        });
        expect(body).not.toHaveProperty('organizationId');

        const stored = await prisma.customer.findUniqueOrThrow({
          where: { id: body.id as string },
        });
        expect(stored.organizationId).toBe(tenant.organizationId);
      },
    );

    it('rejects organizationId in the body and cannot alter ownership', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const response = await app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: {
          name: 'Injected Tenant',
          organizationId: tenantB.organizationId,
        },
      });

      expect(response.statusCode).toBe(400);
      await expect(prisma.customer.count()).resolves.toBe(0);
    });

    it('requires organization context and rejects a foreign tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const missing = await app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: headers(tenantA.accessToken),
        payload: { name: 'Missing Context' },
      });
      const foreign = await app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: headers(tenantA.accessToken, tenantB.organizationId),
        payload: { name: 'Foreign Context' },
      });

      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({
        message: 'Organization context required',
      });
      expect(foreign.statusCode).toBe(403);
      expect(foreign.json()).toEqual({ message: 'Forbidden' });
    });
  });

  describe('list and search', () => {
    it('returns only customers from the active tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const customerB = await createCustomer(tenantB.organizationId);

      const responseA = await app.inject({
        method: 'GET',
        url: '/api/customers',
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });
      const responseB = await app.inject({
        method: 'GET',
        url: '/api/customers',
        headers: headers(tenantB.accessToken, tenantB.organizationId),
      });

      expect(
        responseA.json<{ data: Array<{ id: string }> }>().data.map(({ id }) => id),
      ).toEqual([customerA.id]);
      expect(
        responseB.json<{ data: Array<{ id: string }> }>().data.map(({ id }) => id),
      ).toEqual([customerB.id]);
    });

    it.each([
      ['name', 'Special Customer', 'special'],
      ['email', 'search@example.com', 'SEARCH@EXAMPLE.COM'],
      ['phone', '+1 555 0100', '555 0100'],
      ['identification', 'ID-ABC-123', 'abc-123'],
    ] as const)('searches case-insensitively by %s', async (field, value, search) => {
      const tenant = await createTenant(`search-${field}`);
      await createCustomer(tenant.organizationId, {
        [field]: value,
      });
      await createCustomer(tenant.organizationId, { name: 'Unrelated' });

      const response = await app.inject({
        method: 'GET',
        url: `/api/customers?search=${encodeURIComponent(search)}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown[] }>().data).toHaveLength(1);
    });

    it('paginates with stable metadata', async () => {
      const tenant = await createTenant('pagination');
      await createCustomer(tenant.organizationId, { name: 'Customer 1' });
      await createCustomer(tenant.organizationId, { name: 'Customer 2' });
      await createCustomer(tenant.organizationId, { name: 'Customer 3' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/customers?page=2&limit=2',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const body = response.json<{
        data: unknown[];
        pagination: Record<string, number>;
      }>();

      expect(body.data).toHaveLength(1);
      expect(body.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('lists active customers by default and inactive customers when requested', async () => {
      const tenant = await createTenant('active-filter');
      const active = await createCustomer(tenant.organizationId);
      const inactive = await createCustomer(tenant.organizationId, {
        active: false,
      });

      const defaultResponse = await app.inject({
        method: 'GET',
        url: '/api/customers',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const inactiveResponse = await app.inject({
        method: 'GET',
        url: '/api/customers?active=false',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(
        defaultResponse.json<{ data: Array<{ id: string }> }>().data,
      ).toEqual([expect.objectContaining({ id: active.id })]);
      expect(
        inactiveResponse.json<{ data: Array<{ id: string }> }>().data,
      ).toEqual([expect.objectContaining({ id: inactive.id })]);
    });
  });

  describe('get and update', () => {
    it('gets a customer only inside its tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customer = await createCustomer(tenantA.organizationId);

      const own = await app.inject({
        method: 'GET',
        url: `/api/customers/${customer.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });
      const crossTenant = await app.inject({
        method: 'GET',
        url: `/api/customers/${customer.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
      });
      const missing = await app.inject({
        method: 'GET',
        url: `/api/customers/${randomUUID()}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });

      expect(own.statusCode).toBe(200);
      expect(crossTenant.statusCode).toBe(404);
      expect(crossTenant.json()).toEqual({ message: 'Customer not found' });
      expect(missing.statusCode).toBe(404);
    });

    it('updates owned customers partially', async () => {
      const tenant = await createTenant('update');
      const customer = await createCustomer(tenant.organizationId, {
        name: 'Original',
        phone: '111',
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/customers/${customer.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { name: ' Updated Name ' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Updated Name',
        phone: '111',
      });
    });

    it('returns 404 when another tenant attempts an update', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customer = await createCustomer(tenantA.organizationId);
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/customers/${customer.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
        payload: { name: 'Cross Tenant Update' },
      });

      expect(response.statusCode).toBe(404);
      await expect(
        prisma.customer.findUniqueOrThrow({ where: { id: customer.id } }),
      ).resolves.not.toMatchObject({ name: 'Cross Tenant Update' });
    });

    it('rejects organizationId and invalid email in updates', async () => {
      const tenant = await createTenant('validation');
      const customer = await createCustomer(tenant.organizationId);
      const organizationChange = await app.inject({
        method: 'PATCH',
        url: `/api/customers/${customer.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          organizationId: randomUUID(),
          name: 'Changed',
        },
      });
      const invalidEmail = await app.inject({
        method: 'PATCH',
        url: `/api/customers/${customer.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { email: 'not-an-email' },
      });

      expect(organizationChange.statusCode).toBe(400);
      expect(invalidEmail.statusCode).toBe(400);
    });
  });

  describe('activation', () => {
    it.each(['OWNER', 'ADMIN'] as const)(
      'allows %s to deactivate idempotently',
      async (role) => {
        const tenant = await createTenant(`deactivate-${role}`, role);
        const customer = await createCustomer(tenant.organizationId);

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/customers/${customer.id}/deactivate`,
            headers: headers(tenant.accessToken, tenant.organizationId),
          });
          expect(response.statusCode).toBe(200);
          expect(response.json()).toMatchObject({ active: false });
        }
      },
    );

    it.each(['OWNER', 'ADMIN'] as const)(
      'allows %s to activate idempotently',
      async (role) => {
        const tenant = await createTenant(`activate-${role}`, role);
        const customer = await createCustomer(tenant.organizationId, {
          active: false,
        });

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/customers/${customer.id}/activate`,
            headers: headers(tenant.accessToken, tenant.organizationId),
          });
          expect(response.statusCode).toBe(200);
          expect(response.json()).toMatchObject({ active: true });
        }
      },
    );

    it.each(['deactivate', 'activate'] as const)(
      'forbids MEMBER from %s',
      async (action) => {
        const tenant = await createTenant(`member-${action}`, 'MEMBER');
        const customer = await createCustomer(tenant.organizationId, {
          active: action === 'activate' ? false : true,
        });
        const response = await app.inject({
          method: 'POST',
          url: `/api/customers/${customer.id}/${action}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
        });

        expect(response.statusCode).toBe(403);
      },
    );
  });

  describe('endpoint security', () => {
    it.each([
      ['POST', '/api/customers'],
      ['GET', '/api/customers'],
      ['GET', `/api/customers/${randomUUID()}`],
      ['PATCH', `/api/customers/${randomUUID()}`],
      ['POST', `/api/customers/${randomUUID()}/deactivate`],
      ['POST', `/api/customers/${randomUUID()}/activate`],
    ])('rejects unauthenticated %s %s', async (method, url) => {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    });

    it.each([
      ['POST', '/api/customers'],
      ['GET', '/api/customers'],
      ['GET', `/api/customers/${randomUUID()}`],
      ['PATCH', `/api/customers/${randomUUID()}`],
      ['POST', `/api/customers/${randomUUID()}/deactivate`],
      ['POST', `/api/customers/${randomUUID()}/activate`],
    ])('requires context for authenticated %s %s', async (method, url) => {
      const tenant = await createTenant('missing-context');
      const response = await app.inject({
        method,
        url,
        headers: headers(tenant.accessToken),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        message: 'Organization context required',
      });
    });
  });
});
