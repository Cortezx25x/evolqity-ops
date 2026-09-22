import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type {
  AssetType,
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

describe('assets API', () => {
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
    options: { active?: boolean; name?: string } = {},
  ) {
    return prisma.customer.create({
      data: {
        organizationId,
        name: options.name ?? unique('Customer'),
        active: options.active ?? true,
      },
    });
  }

  async function createAsset(
    organizationId: string,
    customerId: string,
    overrides: {
      type?: AssetType;
      name?: string;
      identifier?: string;
      plate?: string;
      vin?: string;
      serialNumber?: string;
      make?: string;
      model?: string;
      active?: boolean;
    } = {},
  ) {
    return prisma.asset.create({
      data: {
        organizationId,
        customerId,
        name: unique('Asset'),
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
      'allows %s to create an asset',
      async (role) => {
        const tenant = await createTenant(role.toLowerCase(), role);
        const customer = await createCustomer(tenant.organizationId);
        const response = await app.inject({
          method: 'POST',
          url: '/api/assets',
          headers: headers(tenant.accessToken, tenant.organizationId),
          payload: {
            customerId: customer.id,
            type: 'VEHICLE',
            name: '  Service Vehicle  ',
            plate: '  abc-123  ',
            vin: '  vin-test-123  ',
          },
        });
        const body = response.json<Record<string, unknown>>();

        expect(response.statusCode).toBe(201);
        expect(body).toMatchObject({
          type: 'VEHICLE',
          name: 'Service Vehicle',
          plate: 'ABC-123',
          vin: 'VIN-TEST-123',
          customer: {
            id: customer.id,
            name: customer.name,
            type: 'PERSON',
          },
        });
        expect(body).not.toHaveProperty('organizationId');
        expect(body).not.toHaveProperty('customerId');

        const stored = await prisma.asset.findUniqueOrThrow({
          where: { id: body.id as string },
        });
        expect(stored.organizationId).toBe(tenant.organizationId);
      },
    );

    it('rejects organizationId in the request body', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customer = await createCustomer(tenantA.organizationId);
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets',
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: {
          customerId: customer.id,
          name: 'Injected Asset',
          organizationId: tenantB.organizationId,
        },
      });

      expect(response.statusCode).toBe(400);
      await expect(prisma.asset.count()).resolves.toBe(0);
    });

    it('rejects a customer from another tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerB = await createCustomer(tenantB.organizationId);
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets',
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: { customerId: customerB.id, name: 'Cross Tenant Asset' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Invalid customer' });
      await expect(prisma.asset.count()).resolves.toBe(0);
    });

    it('rejects an inactive customer', async () => {
      const tenant = await createTenant('inactive-customer');
      const customer = await createCustomer(tenant.organizationId, {
        active: false,
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/assets',
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { customerId: customer.id, name: 'Inactive Customer Asset' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Invalid customer' });
    });

    it('requires context and rejects an unauthorized tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/assets',
        headers: headers(tenantA.accessToken),
        payload: { customerId: customerA.id, name: 'Missing Context' },
      });
      const foreign = await app.inject({
        method: 'POST',
        url: '/api/assets',
        headers: headers(tenantA.accessToken, tenantB.organizationId),
        payload: { customerId: customerA.id, name: 'Foreign Context' },
      });

      expect(missing.statusCode).toBe(400);
      expect(foreign.statusCode).toBe(403);
    });
  });

  describe('list, search, filters, and pagination', () => {
    it('returns assets only from the selected tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const customerB = await createCustomer(tenantB.organizationId);
      const assetA = await createAsset(
        tenantA.organizationId,
        customerA.id,
      );
      const assetB = await createAsset(
        tenantB.organizationId,
        customerB.id,
      );

      const responseA = await app.inject({
        method: 'GET',
        url: '/api/assets',
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });
      const responseB = await app.inject({
        method: 'GET',
        url: '/api/assets',
        headers: headers(tenantB.accessToken, tenantB.organizationId),
      });

      expect(
        responseA.json<{ data: Array<{ id: string }> }>().data.map(({ id }) => id),
      ).toEqual([assetA.id]);
      expect(
        responseB.json<{ data: Array<{ id: string }> }>().data.map(({ id }) => id),
      ).toEqual([assetB.id]);
    });

    it.each([
      ['name', 'Special Asset', 'special'],
      ['plate', 'ABC-987', 'abc-987'],
      ['vin', 'VIN-SEARCH-1', 'vin-search'],
      ['serialNumber', 'SERIAL-4455', '4455'],
      ['make', 'Toyota', 'toyota'],
      ['model', 'Hilux', 'hilux'],
    ] as const)('searches case-insensitively by %s', async (field, value, search) => {
      const tenant = await createTenant(`search-${field}`);
      const customer = await createCustomer(tenant.organizationId);
      await createAsset(tenant.organizationId, customer.id, {
        [field]: value,
      });
      await createAsset(tenant.organizationId, customer.id, {
        name: 'Unrelated Asset',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/assets?search=${encodeURIComponent(search)}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown[] }>().data).toHaveLength(1);
    });

    it('filters by type and customerId', async () => {
      const tenant = await createTenant('filters');
      const customerA = await createCustomer(tenant.organizationId);
      const customerB = await createCustomer(tenant.organizationId);
      const vehicle = await createAsset(
        tenant.organizationId,
        customerA.id,
        { type: 'VEHICLE' },
      );
      const device = await createAsset(
        tenant.organizationId,
        customerB.id,
        { type: 'DEVICE' },
      );

      const byType = await app.inject({
        method: 'GET',
        url: '/api/assets?type=DEVICE',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const byCustomer = await app.inject({
        method: 'GET',
        url: `/api/assets?customerId=${customerA.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(byType.json<{ data: Array<{ id: string }> }>().data).toEqual([
        expect.objectContaining({ id: device.id }),
      ]);
      expect(
        byCustomer.json<{ data: Array<{ id: string }> }>().data,
      ).toEqual([expect.objectContaining({ id: vehicle.id })]);
    });

    it('paginates and filters active status', async () => {
      const tenant = await createTenant('pagination');
      const customer = await createCustomer(tenant.organizationId);
      await createAsset(tenant.organizationId, customer.id);
      await createAsset(tenant.organizationId, customer.id);
      await createAsset(tenant.organizationId, customer.id);
      const inactive = await createAsset(
        tenant.organizationId,
        customer.id,
        { active: false },
      );

      const page = await app.inject({
        method: 'GET',
        url: '/api/assets?page=2&limit=2',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const inactiveResponse = await app.inject({
        method: 'GET',
        url: '/api/assets?active=false',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const pageBody = page.json<{
        data: Array<{ id: string }>;
        pagination: Record<string, number>;
      }>();

      expect(pageBody.data).toHaveLength(1);
      expect(pageBody.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(pageBody.data[0]?.id).toBeDefined();
      expect(
        inactiveResponse.json<{ data: Array<{ id: string }> }>().data,
      ).toEqual([expect.objectContaining({ id: inactive.id })]);
    });
  });

  describe('get and update', () => {
    it('gets an asset only inside its tenant', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const assetA = await createAsset(
        tenantA.organizationId,
        customerA.id,
      );

      const own = await app.inject({
        method: 'GET',
        url: `/api/assets/${assetA.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });
      const crossTenant = await app.inject({
        method: 'GET',
        url: `/api/assets/${assetA.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
      });
      const missing = await app.inject({
        method: 'GET',
        url: `/api/assets/${randomUUID()}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });

      expect(own.statusCode).toBe(200);
      expect(own.json()).toMatchObject({
        id: assetA.id,
        customer: { id: customerA.id },
      });
      expect(own.json()).not.toHaveProperty('organizationId');
      expect(crossTenant.statusCode).toBe(404);
      expect(crossTenant.json()).toEqual({ message: 'Asset not found' });
      expect(missing.statusCode).toBe(404);
    });

    it('updates an owned asset partially and normalizes plate and VIN', async () => {
      const tenant = await createTenant('update');
      const customer = await createCustomer(tenant.organizationId);
      const asset = await createAsset(tenant.organizationId, customer.id, {
        name: 'Original',
        make: 'Original Make',
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${asset.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          name: ' Updated Asset ',
          plate: ' plate-123 ',
          vin: ' vin-123 ',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Updated Asset',
        make: 'Original Make',
        plate: 'PLATE-123',
        vin: 'VIN-123',
      });
    });

    it('returns 404 when another tenant attempts an update', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const assetA = await createAsset(
        tenantA.organizationId,
        customerA.id,
      );
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${assetA.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
        payload: { name: 'Cross Tenant Update' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('transfers an asset to an active customer in the same tenant', async () => {
      const tenant = await createTenant('transfer');
      const customerA = await createCustomer(tenant.organizationId);
      const customerB = await createCustomer(tenant.organizationId);
      const asset = await createAsset(
        tenant.organizationId,
        customerA.id,
      );
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${asset.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { customerId: customerB.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        customer: { id: customerB.id },
      });
    });

    it('rejects transfers to a foreign or inactive customer', async () => {
      const tenantA = await createTenant('tenant-a');
      const tenantB = await createTenant('tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const foreignCustomer = await createCustomer(tenantB.organizationId);
      const inactiveCustomer = await createCustomer(tenantA.organizationId, {
        active: false,
      });
      const asset = await createAsset(
        tenantA.organizationId,
        customerA.id,
      );

      for (const customerId of [foreignCustomer.id, inactiveCustomer.id]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/assets/${asset.id}`,
          headers: headers(tenantA.accessToken, tenantA.organizationId),
          payload: { customerId },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ message: 'Invalid customer' });
      }
    });

    it('rejects organizationId changes', async () => {
      const tenant = await createTenant('organization-change');
      const customer = await createCustomer(tenant.organizationId);
      const asset = await createAsset(tenant.organizationId, customer.id);
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/assets/${asset.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          organizationId: randomUUID(),
          name: 'Forbidden Change',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('activation', () => {
    it.each(['OWNER', 'ADMIN'] as const)(
      'allows %s to deactivate idempotently',
      async (role) => {
        const tenant = await createTenant(`deactivate-${role}`, role);
        const customer = await createCustomer(tenant.organizationId);
        const asset = await createAsset(tenant.organizationId, customer.id);

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/assets/${asset.id}/deactivate`,
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
        const customer = await createCustomer(tenant.organizationId);
        const asset = await createAsset(tenant.organizationId, customer.id, {
          active: false,
        });

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/assets/${asset.id}/activate`,
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
        const customer = await createCustomer(tenant.organizationId);
        const asset = await createAsset(tenant.organizationId, customer.id, {
          active: action === 'activate' ? false : true,
        });
        const response = await app.inject({
          method: 'POST',
          url: `/api/assets/${asset.id}/${action}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
        });

        expect(response.statusCode).toBe(403);
      },
    );
  });

  describe('inactive customer behavior and security', () => {
    it('keeps existing assets when their customer becomes inactive', async () => {
      const tenant = await createTenant('inactive-parent');
      const customer = await createCustomer(tenant.organizationId);
      const asset = await createAsset(tenant.organizationId, customer.id);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { active: false },
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/assets/${asset.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/assets',
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          customerId: customer.id,
          name: 'New Asset For Inactive Customer',
        },
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toMatchObject({ id: asset.id, active: true });
      expect(createResponse.statusCode).toBe(400);
      await expect(
        prisma.asset.findUnique({ where: { id: asset.id } }),
      ).resolves.not.toBeNull();
    });

    it.each([
      ['POST', '/api/assets'],
      ['GET', '/api/assets'],
      ['GET', `/api/assets/${randomUUID()}`],
      ['PATCH', `/api/assets/${randomUUID()}`],
      ['POST', `/api/assets/${randomUUID()}/deactivate`],
      ['POST', `/api/assets/${randomUUID()}/activate`],
    ])('rejects unauthenticated %s %s', async (method, url) => {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    });

    it.each([
      ['POST', '/api/assets'],
      ['GET', '/api/assets'],
      ['GET', `/api/assets/${randomUUID()}`],
      ['PATCH', `/api/assets/${randomUUID()}`],
      ['POST', `/api/assets/${randomUUID()}/deactivate`],
      ['POST', `/api/assets/${randomUUID()}/activate`],
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
