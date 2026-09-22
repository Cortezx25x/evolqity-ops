import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type {
  OrganizationRole,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';

interface TenantIdentity {
  userId: string;
  organizationId: string;
  membershipId: string;
  accessToken: string;
}

interface WorkOrderResponse {
  id: string;
  number: number;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  title: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  customer: { id: string; name: string; type: string };
  asset: { id: string; name: string; plate: string | null } | null;
  assignedTo: {
    membershipId: string;
    user: { id: string; email: string };
  } | null;
  createdBy: {
    membershipId: string;
    user: { id: string; email: string };
  };
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

describe('work orders API', () => {
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
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createMembership(
    organizationId: string,
    options: { active?: boolean; role?: OrganizationRole } = {},
  ) {
    const user = await prisma.user.create({
      data: { email: `${unique('member')}@example.com` },
      select: { id: true, email: true },
    });
    const membership = await prisma.organizationUser.create({
      data: {
        organizationId,
        userId: user.id,
        active: options.active ?? true,
        role: options.role ?? 'MEMBER',
      },
      select: { id: true },
    });

    return { ...membership, user };
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
    options: {
      active?: boolean;
      name?: string;
      plate?: string;
    } = {},
  ) {
    return prisma.asset.create({
      data: {
        organizationId,
        customerId,
        name: options.name ?? unique('Asset'),
        plate: options.plate,
        active: options.active ?? true,
      },
    });
  }

  async function postWorkOrder(
    tenant: TenantIdentity,
    customerId: string,
    body: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/work-orders',
      headers: headers(tenant.accessToken, tenant.organizationId),
      payload: {
        customerId,
        title: unique('Work order'),
        priority: 'NORMAL',
        ...body,
      },
    });
  }

  async function mustCreateWorkOrder(
    tenant: TenantIdentity,
    customerId: string,
    body: Record<string, unknown> = {},
  ): Promise<WorkOrderResponse> {
    const response = await postWorkOrder(tenant, customerId, body);
    expect(response.statusCode).toBe(201);
    return response.json<WorkOrderResponse>();
  }

  async function changeStatus(
    tenant: TenantIdentity,
    workOrderId: string,
    status: WorkOrderStatus,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrderId}/status`,
      headers: headers(tenant.accessToken, tenant.organizationId),
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
      '%s can create an OPEN work order',
      async (role) => {
        const tenant = await createTenant(role, role);
        const customer = await createCustomer(tenant.organizationId);

        const response = await postWorkOrder(tenant, customer.id, {
          title: '  Initial repair  ',
          description: 'Inspect unit',
        });
        const body = response.json<WorkOrderResponse>();

        expect(response.statusCode).toBe(201);
        expect(body).toMatchObject({
          number: 1,
          status: 'OPEN',
          priority: 'NORMAL',
          title: 'Initial repair',
          customer: { id: customer.id },
          createdBy: { membershipId: tenant.membershipId },
        });
        expect(body).not.toHaveProperty('organizationId');
      },
    );

    it('increments independently per organization', async () => {
      const tenantA = await createTenant('number-a');
      const tenantB = await createTenant('number-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const customerB = await createCustomer(tenantB.organizationId);

      const firstA = await mustCreateWorkOrder(tenantA, customerA.id);
      const secondA = await mustCreateWorkOrder(tenantA, customerA.id);
      const firstB = await mustCreateWorkOrder(tenantB, customerB.id);

      expect([firstA.number, secondA.number]).toEqual([1, 2]);
      expect(firstB.number).toBe(1);
    });

    it('rolls back the counter when create fails after incrementing it', async () => {
      const tenant = await createTenant('rollback-number');
      const customer = await createCustomer(tenant.organizationId);
      await mustCreateWorkOrder(tenant, customer.id);
      await prisma.organization.update({
        where: { id: tenant.organizationId },
        data: { nextWorkOrderNumber: 1 },
      });

      const before = await prisma.organization.findUniqueOrThrow({
        where: { id: tenant.organizationId },
        select: { nextWorkOrderNumber: true },
      });
      const response = await postWorkOrder(tenant, customer.id, {
        title: 'Must fail on duplicate number',
      });
      const after = await prisma.organization.findUniqueOrThrow({
        where: { id: tenant.organizationId },
        select: { nextWorkOrderNumber: true },
      });

      expect(before.nextWorkOrderNumber).toBe(1);
      expect(response.statusCode).toBe(500);
      expect(after.nextWorkOrderNumber).toBe(before.nextWorkOrderNumber);
      await expect(
        prisma.workOrder.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).resolves.toBe(1);
    });

    it.each(['organizationId', 'number', 'status'] as const)(
      'rejects server-controlled field %s',
      async (field) => {
        const tenant = await createTenant(`strict-${field}`);
        const customer = await createCustomer(tenant.organizationId);

        const response = await postWorkOrder(tenant, customer.id, {
          [field]: field === 'number' ? 99 : 'OPEN',
        });

        expect(response.statusCode).toBe(400);
      },
    );

    it('rejects additional server-controlled create fields', async () => {
      const tenant = await createTenant('strict-create-fields');
      const customer = await createCustomer(tenant.organizationId);
      const response = await postWorkOrder(tenant, customer.id, {
        createdByMembershipId: tenant.membershipId,
        startedAt: '2026-09-19T12:00:00.000Z',
        completedAt: '2026-09-19T13:00:00.000Z',
        cancelledAt: '2026-09-19T14:00:00.000Z',
        createdAt: '2026-09-19T10:00:00.000Z',
        updatedAt: '2026-09-19T11:00:00.000Z',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Invalid request body' });
    });

    it('validates customer, asset, and their ownership without tenant leaks', async () => {
      const tenantA = await createTenant('relations-a');
      const tenantB = await createTenant('relations-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const customerA2 = await createCustomer(tenantA.organizationId);
      const inactiveCustomer = await createCustomer(tenantA.organizationId, {
        active: false,
      });
      const customerB = await createCustomer(tenantB.organizationId);
      const assetA = await createAsset(
        tenantA.organizationId,
        customerA.id,
      );
      const inactiveAsset = await createAsset(
        tenantA.organizationId,
        customerA.id,
        { active: false },
      );
      const assetB = await createAsset(
        tenantB.organizationId,
        customerB.id,
      );

      const valid = await postWorkOrder(tenantA, customerA.id, {
        assetId: assetA.id,
      });
      expect(valid.statusCode).toBe(201);

      for (const customerId of [customerB.id, inactiveCustomer.id]) {
        const response = await postWorkOrder(tenantA, customerId);
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ message: 'Invalid customer' });
      }

      for (const [customerId, assetId] of [
        [customerA.id, assetB.id],
        [customerA2.id, assetA.id],
        [customerA.id, inactiveAsset.id],
      ]) {
        const response = await postWorkOrder(tenantA, customerId, { assetId });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ message: 'Invalid asset' });
      }
    });

    it('accepts only an active assignee membership from the tenant', async () => {
      const tenantA = await createTenant('assignee-a');
      const tenantB = await createTenant('assignee-b');
      const customer = await createCustomer(tenantA.organizationId);
      const validAssignee = await createMembership(tenantA.organizationId);
      const inactiveAssignee = await createMembership(
        tenantA.organizationId,
        { active: false },
      );
      const foreignAssignee = await createMembership(tenantB.organizationId);

      const valid = await postWorkOrder(tenantA, customer.id, {
        assignedToMembershipId: validAssignee.id,
      });
      expect(valid.statusCode).toBe(201);
      expect(
        valid.json<WorkOrderResponse>().assignedTo?.membershipId,
      ).toBe(validAssignee.id);

      for (const assignedToMembershipId of [
        inactiveAssignee.id,
        foreignAssignee.id,
      ]) {
        const response = await postWorkOrder(tenantA, customer.id, {
          assignedToMembershipId,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ message: 'Invalid assignee' });
      }
    });

    it(
      'allocates unique consecutive numbers under concurrent creates',
      async () => {
        const tenant = await createTenant('concurrent');
        const customer = await createCustomer(tenant.organizationId);

        const responses = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            postWorkOrder(tenant, customer.id, {
              title: `Concurrent ${index}`,
            }),
          ),
        );

        expect(responses.map((response) => response.statusCode)).toEqual(
          Array.from({ length: 10 }, () => 201),
        );
        const numbers = responses
          .map((response) => response.json<WorkOrderResponse>().number)
          .sort((left, right) => left - right);

        expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(new Set(numbers).size).toBe(10);
        await expect(
          prisma.workOrder.count({
            where: { organizationId: tenant.organizationId },
          }),
        ).resolves.toBe(10);
      },
      60_000,
    );
  });

  describe('list and get', () => {
    it(
      'isolates tenants and supports filters, search, and numeric search',
      async () => {
        const tenantA = await createTenant('list-a');
        const tenantB = await createTenant('list-b');
        const assignee = await createMembership(tenantA.organizationId);
        const otherAssignee = await createMembership(tenantA.organizationId);
        const customerA = await createCustomer(tenantA.organizationId, {
          name: 'Acme Logistics',
        });
        const otherCustomer = await createCustomer(tenantA.organizationId, {
          name: 'Beta Industries',
        });
        const customerB = await createCustomer(tenantB.organizationId);
        const assetA = await createAsset(
          tenantA.organizationId,
          customerA.id,
          { name: 'Delivery Van', plate: 'OPS-321' },
        );
        const otherAsset = await createAsset(
          tenantA.organizationId,
          otherCustomer.id,
          { name: 'Warehouse Forklift', plate: 'BETA-900' },
        );
        const high = await mustCreateWorkOrder(tenantA, customerA.id, {
          title: 'Engine diagnostic',
          diagnosis: 'Fuel pressure',
          priority: 'HIGH',
          assetId: assetA.id,
          assignedToMembershipId: assignee.id,
        });
        const sameCustomer = await mustCreateWorkOrder(
          tenantA,
          customerA.id,
          {
          title: 'Second task',
          },
        );
        const decoy = await mustCreateWorkOrder(
          tenantA,
          otherCustomer.id,
          {
            title: 'Unrelated hydraulic service',
            priority: 'LOW',
            assetId: otherAsset.id,
            assignedToMembershipId: otherAssignee.id,
          },
        );
        const foreign = await mustCreateWorkOrder(tenantB, customerB.id);
        await changeStatus(tenantA, high.id, 'IN_PROGRESS');
        await changeStatus(tenantA, decoy.id, 'WAITING');

        const cases: Array<[string, string[]]> = [
          ['status=IN_PROGRESS', [high.id]],
          ['priority=HIGH', [high.id]],
          [`customerId=${customerA.id}`, [high.id, sameCustomer.id]],
          [`assetId=${assetA.id}`, [high.id]],
          [`assignedToMembershipId=${assignee.id}`, [high.id]],
          ['search=engine', [high.id]],
          ['search=Acme', [high.id, sameCustomer.id]],
          ['search=Delivery', [high.id]],
          ['search=OPS-321', [high.id]],
          ['search=Fuel', [high.id]],
          [`search=${high.number}`, [high.id]],
        ];

        for (const [query, expectedIds] of cases) {
          const response = await app.inject({
            method: 'GET',
            url: `/api/work-orders?${query}`,
            headers: headers(tenantA.accessToken, tenantA.organizationId),
          });
          const body = response.json<{
            data: WorkOrderResponse[];
            pagination: { total: number };
          }>();

          expect(response.statusCode).toBe(200);
          expect(body.data.map((item) => item.id).sort()).toEqual(
            [...expectedIds].sort(),
          );
          expect(body.data).toHaveLength(expectedIds.length);
          expect(body.pagination.total).toBe(expectedIds.length);
        }

        const listA = await app.inject({
          method: 'GET',
          url: '/api/work-orders',
          headers: headers(tenantA.accessToken, tenantA.organizationId),
        });
        const listB = await app.inject({
          method: 'GET',
          url: '/api/work-orders',
          headers: headers(tenantB.accessToken, tenantB.organizationId),
        });
        const bodyA = listA.json<{
          data: WorkOrderResponse[];
          pagination: { total: number };
        }>();
        const bodyB = listB.json<{
          data: WorkOrderResponse[];
          pagination: { total: number };
        }>();

        expect(bodyA.data.map((item) => item.id).sort()).toEqual(
          [high.id, sameCustomer.id, decoy.id].sort(),
        );
        expect(bodyA.pagination.total).toBe(3);
        expect(bodyA.data.some((item) => item.id === foreign.id)).toBe(false);
        expect(bodyB.data.map((item) => item.id)).toEqual([foreign.id]);
        expect(bodyB.pagination.total).toBe(1);
      },
      60_000,
    );

    it('paginates with defaults and a maximum limit', async () => {
      const tenant = await createTenant('pagination');
      const customer = await createCustomer(tenant.organizationId);
      const workOrders: WorkOrderResponse[] = [];

      for (let index = 0; index < 3; index += 1) {
        workOrders.push(
          await mustCreateWorkOrder(tenant, customer.id, {
            title: `Page item ${index}`,
          }),
        );
      }
      const orderedDates = [
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-01-02T00:00:00.000Z'),
        new Date('2026-01-03T00:00:00.000Z'),
      ];
      await Promise.all(
        workOrders.map((workOrder, index) =>
          prisma.workOrder.update({
            where: { id: workOrder.id },
            data: { createdAt: orderedDates[index] },
          }),
        ),
      );

      const defaultResponse = await app.inject({
        method: 'GET',
        url: '/api/work-orders',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const defaultBody = defaultResponse.json<{
        data: WorkOrderResponse[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>();

      expect(defaultResponse.statusCode).toBe(200);
      expect(defaultBody.data.map((item) => item.id)).toEqual([
        workOrders[2]?.id,
        workOrders[1]?.id,
        workOrders[0]?.id,
      ]);
      expect(defaultBody.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });

      const secondPageResponse = await app.inject({
        method: 'GET',
        url: '/api/work-orders?page=2&limit=2',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const secondPageBody = secondPageResponse.json<{
        data: WorkOrderResponse[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>();

      expect(secondPageResponse.statusCode).toBe(200);
      expect(secondPageBody.data.map((item) => item.id)).toEqual([
        workOrders[0]?.id,
      ]);
      expect(secondPageBody.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/work-orders?limit=101',
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      expect(invalid.statusCode).toBe(400);
    });

    it('gets a tenant work order and hides it cross-tenant', async () => {
      const tenantA = await createTenant('get-a');
      const tenantB = await createTenant('get-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const workOrder = await mustCreateWorkOrder(tenantA, customerA.id);

      const own = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });
      const foreign = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
      });
      const missing = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${randomUUID()}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });

      expect(own.statusCode).toBe(200);
      expect(foreign.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('update', () => {
    it('updates editable fields and can assign or clear optional relations', async () => {
      const tenant = await createTenant('update');
      const customer = await createCustomer(tenant.organizationId);
      const asset = await createAsset(tenant.organizationId, customer.id);
      const assignee = await createMembership(tenant.organizationId);
      const workOrder = await mustCreateWorkOrder(tenant, customer.id);

      const assigned = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          title: 'Updated title',
          resolution: 'Replaced component',
          priority: 'URGENT',
          assetId: asset.id,
          assignedToMembershipId: assignee.id,
          scheduledAt: '2026-10-01T15:00:00.000Z',
        },
      });
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json()).toMatchObject({
        title: 'Updated title',
        resolution: 'Replaced component',
        priority: 'URGENT',
        asset: { id: asset.id },
        assignedTo: { membershipId: assignee.id },
      });

      const cleared = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          assetId: null,
          assignedToMembershipId: null,
          scheduledAt: null,
        },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({
        asset: null,
        assignedTo: null,
        scheduledAt: null,
      });
    });

    it('validates resulting Customer and Asset together', async () => {
      const tenantA = await createTenant('transfer-a');
      const tenantB = await createTenant('transfer-b');
      const customerA1 = await createCustomer(tenantA.organizationId);
      const customerA2 = await createCustomer(tenantA.organizationId);
      const customerB = await createCustomer(tenantB.organizationId);
      const assetA1 = await createAsset(
        tenantA.organizationId,
        customerA1.id,
      );
      const assetA2 = await createAsset(
        tenantA.organizationId,
        customerA2.id,
      );
      const workOrder = await mustCreateWorkOrder(tenantA, customerA1.id, {
        assetId: assetA1.id,
      });

      const incompatible = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: { customerId: customerA2.id },
      });
      expect(incompatible.statusCode).toBe(400);
      expect(incompatible.json()).toEqual({ message: 'Invalid asset' });

      const compatible = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: { customerId: customerA2.id, assetId: assetA2.id },
      });
      expect(compatible.statusCode).toBe(200);
      expect(compatible.json()).toMatchObject({
        customer: { id: customerA2.id },
        asset: { id: assetA2.id },
      });

      const foreignCustomer = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: { customerId: customerB.id },
      });
      expect(foreignCustomer.statusCode).toBe(400);
      expect(foreignCustomer.json()).toEqual({
        message: 'Invalid customer',
      });
    });

    it('rejects changing only the Asset when the resulting Customer is inactive', async () => {
      const tenant = await createTenant('inactive-customer-transfer');
      const customer = await createCustomer(tenant.organizationId);
      const assetA = await createAsset(tenant.organizationId, customer.id, {
        name: 'Asset A',
      });
      const assetB = await createAsset(tenant.organizationId, customer.id, {
        name: 'Asset B',
      });
      const workOrder = await mustCreateWorkOrder(tenant, customer.id, {
        assetId: assetA.id,
      });
      await prisma.customer.update({
        where: { id: customer.id },
        data: { active: false },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { assetId: assetB.id },
      });
      const stored = await prisma.workOrder.findUniqueOrThrow({
        where: { id: workOrder.id },
        select: { assetId: true },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Invalid customer' });
      expect(stored.assetId).toBe(assetA.id);
    });

    it('rejects foreign assignees, cross-tenant updates, and controlled fields', async () => {
      const tenantA = await createTenant('update-security-a');
      const tenantB = await createTenant('update-security-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const workOrder = await mustCreateWorkOrder(tenantA, customerA.id);
      const foreignAssignee = await createMembership(tenantB.organizationId);

      const foreignAssignment = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: { assignedToMembershipId: foreignAssignee.id },
      });
      expect(foreignAssignment.statusCode).toBe(400);

      const crossTenant = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
        payload: { title: 'Not allowed' },
      });
      expect(crossTenant.statusCode).toBe(404);

      for (const payload of [
        { number: 100 },
        { organizationId: tenantB.organizationId },
        { status: 'COMPLETED' },
      ]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/work-orders/${workOrder.id}`,
          headers: headers(tenantA.accessToken, tenantA.organizationId),
          payload,
        });
        expect(response.statusCode).toBe(400);
      }

      const additionalControlledFields = await app.inject({
        method: 'PATCH',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
        payload: {
          createdByMembershipId: tenantA.membershipId,
          startedAt: '2026-09-19T12:00:00.000Z',
          completedAt: '2026-09-19T13:00:00.000Z',
          cancelledAt: '2026-09-19T14:00:00.000Z',
          createdAt: '2026-09-19T10:00:00.000Z',
          updatedAt: '2026-09-19T11:00:00.000Z',
        },
      });
      expect(additionalControlledFields.statusCode).toBe(400);
      expect(additionalControlledFields.json()).toEqual({
        message: 'Invalid request body',
      });
    });
  });

  describe('status workflow and closed orders', () => {
    it('sets startedAt once across IN_PROGRESS and WAITING', async () => {
      const tenant = await createTenant('started');
      const customer = await createCustomer(tenant.organizationId);
      const workOrder = await mustCreateWorkOrder(tenant, customer.id);

      const started = await changeStatus(
        tenant,
        workOrder.id,
        'IN_PROGRESS',
      );
      expect(started.statusCode).toBe(200);
      const startedAt =
        started.json<WorkOrderResponse>().startedAt;
      expect(startedAt).not.toBeNull();

      const idempotent = await changeStatus(
        tenant,
        workOrder.id,
        'IN_PROGRESS',
      );
      expect(idempotent.statusCode).toBe(200);
      expect(idempotent.json<WorkOrderResponse>().startedAt).toBe(startedAt);

      expect(
        (await changeStatus(tenant, workOrder.id, 'WAITING')).statusCode,
      ).toBe(200);
      const resumed = await changeStatus(
        tenant,
        workOrder.id,
        'IN_PROGRESS',
      );
      expect(resumed.json<WorkOrderResponse>().startedAt).toBe(startedAt);
    });

    it('sets terminal timestamps and makes same-status updates idempotent', async () => {
      const tenant = await createTenant('terminal-time');
      const customer = await createCustomer(tenant.organizationId);
      const completedOrder = await mustCreateWorkOrder(tenant, customer.id);
      const cancelledOrder = await mustCreateWorkOrder(tenant, customer.id);

      const completed = await changeStatus(
        tenant,
        completedOrder.id,
        'COMPLETED',
      );
      expect(completed.statusCode).toBe(200);
      const completedAt =
        completed.json<WorkOrderResponse>().completedAt;
      expect(completedAt).not.toBeNull();

      const idempotent = await changeStatus(
        tenant,
        completedOrder.id,
        'COMPLETED',
      );
      expect(idempotent.statusCode).toBe(200);
      expect(idempotent.json<WorkOrderResponse>().status).toBe('COMPLETED');
      expect(idempotent.json<WorkOrderResponse>().completedAt).toBe(
        completedAt,
      );

      const cancelled = await changeStatus(
        tenant,
        cancelledOrder.id,
        'CANCELLED',
      );
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json<WorkOrderResponse>().cancelledAt).not.toBeNull();
    });

    it('rejects invalid and terminal transitions', async () => {
      const tenant = await createTenant('invalid-status');
      const customer = await createCustomer(tenant.organizationId);
      const workOrder = await mustCreateWorkOrder(tenant, customer.id);

      const invalid = await changeStatus(tenant, workOrder.id, 'DRAFT');
      expect(invalid.statusCode).toBe(409);
      expect(invalid.json()).toEqual({
        message: 'Invalid status transition',
      });

      await changeStatus(tenant, workOrder.id, 'COMPLETED');
      const terminal = await changeStatus(tenant, workOrder.id, 'WAITING');
      expect(terminal.statusCode).toBe(409);
    });

    it('supports administrative DRAFT transitions and forbids MEMBER', async () => {
      const owner = await createTenant('draft-owner', 'OWNER');
      const admin = await createTenant('draft-admin', 'ADMIN');
      const member = await createTenant('draft-member', 'MEMBER');
      const ownerCustomer = await createCustomer(owner.organizationId);
      const adminCustomer = await createCustomer(admin.organizationId);
      const memberCustomer = await createCustomer(member.organizationId);
      const ownerOrder = await mustCreateWorkOrder(owner, ownerCustomer.id);
      const adminOrder = await mustCreateWorkOrder(admin, adminCustomer.id);
      const memberOrder = await mustCreateWorkOrder(member, memberCustomer.id);
      await prisma.workOrder.updateMany({
        where: {
          id: { in: [ownerOrder.id, adminOrder.id, memberOrder.id] },
        },
        data: { status: 'DRAFT' },
      });

      const opened = await changeStatus(owner, ownerOrder.id, 'OPEN');
      const cancelled = await changeStatus(
        admin,
        adminOrder.id,
        'CANCELLED',
      );
      const forbidden = await changeStatus(member, memberOrder.id, 'OPEN');
      const storedMemberOrder = await prisma.workOrder.findUniqueOrThrow({
        where: { id: memberOrder.id },
        select: { status: true },
      });

      expect(opened.statusCode).toBe(200);
      expect(opened.json<WorkOrderResponse>().status).toBe('OPEN');
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json<WorkOrderResponse>().status).toBe('CANCELLED');
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toEqual({ message: 'Forbidden' });
      expect(storedMemberOrder.status).toBe('DRAFT');
    });

    it('returns 404 for a cross-tenant status change without mutating it', async () => {
      const tenantA = await createTenant('status-tenant-a');
      const tenantB = await createTenant('status-tenant-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const workOrder = await mustCreateWorkOrder(tenantA, customerA.id);

      const response = await changeStatus(
        tenantB,
        workOrder.id,
        'IN_PROGRESS',
      );
      const stored = await prisma.workOrder.findUniqueOrThrow({
        where: { id: workOrder.id },
        select: { status: true, startedAt: true },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: 'Work order not found' });
      expect(stored).toEqual({ status: 'OPEN', startedAt: null });
    });

    it('allows MEMBER operational transitions but forbids cancellation', async () => {
      const tenant = await createTenant('member-status', 'MEMBER');
      const customer = await createCustomer(tenant.organizationId);
      const workOrder = await mustCreateWorkOrder(tenant, customer.id);

      expect(
        (await changeStatus(tenant, workOrder.id, 'IN_PROGRESS')).statusCode,
      ).toBe(200);
      expect(
        (await changeStatus(tenant, workOrder.id, 'WAITING')).statusCode,
      ).toBe(200);
      expect(
        (await changeStatus(tenant, workOrder.id, 'CANCELLED')).statusCode,
      ).toBe(403);
      expect(
        (await changeStatus(tenant, workOrder.id, 'COMPLETED')).statusCode,
      ).toBe(200);
    });

    it.each(['OWNER', 'ADMIN'] as const)(
      '%s can cancel a work order',
      async (role) => {
        const tenant = await createTenant(`cancel-${role}`, role);
        const customer = await createCustomer(tenant.organizationId);
        const workOrder = await mustCreateWorkOrder(tenant, customer.id);

        const response = await changeStatus(
          tenant,
          workOrder.id,
          'CANCELLED',
        );
        expect(response.statusCode).toBe(200);
      },
    );

    it.each(['COMPLETED', 'CANCELLED'] as const)(
      'rejects PATCH for a %s work order while GET and LIST remain available',
      async (status) => {
        const tenant = await createTenant(`closed-${status}`);
        const customer = await createCustomer(tenant.organizationId);
        const workOrder = await mustCreateWorkOrder(tenant, customer.id);
        await changeStatus(tenant, workOrder.id, status);

        const update = await app.inject({
          method: 'PATCH',
          url: `/api/work-orders/${workOrder.id}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
          payload: { title: 'Too late' },
        });
        const get = await app.inject({
          method: 'GET',
          url: `/api/work-orders/${workOrder.id}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
        });
        const list = await app.inject({
          method: 'GET',
          url: `/api/work-orders?status=${status}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
        });

        expect(update.statusCode).toBe(409);
        expect(update.json()).toEqual({ message: 'Work order is closed' });
        expect(get.statusCode).toBe(200);
        expect(list.statusCode).toBe(200);
        expect(list.json<{ data: unknown[] }>().data).toHaveLength(1);
      },
    );
  });

  describe('inactive relations and security', () => {
    it('keeps existing work orders after customer and asset deactivation', async () => {
      const tenant = await createTenant('inactive-existing');
      const customer = await createCustomer(tenant.organizationId);
      const asset = await createAsset(tenant.organizationId, customer.id);
      const workOrder = await mustCreateWorkOrder(tenant, customer.id, {
        assetId: asset.id,
      });

      await prisma.customer.update({
        where: { id: customer.id },
        data: { active: false },
      });
      await prisma.asset.update({
        where: { id: asset.id },
        data: { active: false },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        customer: { id: customer.id },
        asset: { id: asset.id },
      });
    });

    it('requires authentication and organization context', async () => {
      const tenant = await createTenant('context');
      const customer = await createCustomer(tenant.organizationId);

      const anonymous = await app.inject({
        method: 'POST',
        url: '/api/work-orders',
        payload: { customerId: customer.id, title: 'Anonymous' },
      });
      const missingContext = await app.inject({
        method: 'POST',
        url: '/api/work-orders',
        headers: headers(tenant.accessToken),
        payload: { customerId: customer.id, title: 'No context' },
      });

      expect(anonymous.statusCode).toBe(401);
      expect(missingContext.statusCode).toBe(400);
    });

    it('returns only the documented public relation shapes', async () => {
      const tenant = await createTenant('public-shapes');
      const customer = await createCustomer(tenant.organizationId);
      const asset = await createAsset(tenant.organizationId, customer.id, {
        name: 'Public Asset',
        plate: 'PUB-100',
      });
      const assignee = await createMembership(tenant.organizationId);
      const workOrder = await mustCreateWorkOrder(tenant, customer.id, {
        assetId: asset.id,
        assignedToMembershipId: assignee.id,
      });

      expect(Object.keys(workOrder.customer).sort()).toEqual(
        ['id', 'name', 'type'].sort(),
      );
      expect(Object.keys(workOrder.asset ?? {}).sort()).toEqual(
        ['id', 'name', 'type', 'plate', 'make', 'model'].sort(),
      );
      expect(Object.keys(workOrder.assignedTo ?? {}).sort()).toEqual(
        ['membershipId', 'user'].sort(),
      );
      expect(Object.keys(workOrder.assignedTo?.user ?? {}).sort()).toEqual(
        ['id', 'email', 'firstName', 'lastName'].sort(),
      );
      expect(Object.keys(workOrder.createdBy).sort()).toEqual(
        ['membershipId', 'user'].sort(),
      );
      expect(Object.keys(workOrder.createdBy.user).sort()).toEqual(
        ['id', 'email', 'firstName', 'lastName'].sort(),
      );
      expect(workOrder).not.toHaveProperty('organizationId');

      const serialized = JSON.stringify(workOrder);
      for (const forbiddenField of [
        'organizationId',
        'passwordHash',
        'sessions',
        'refreshTokens',
        'tokenHash',
      ]) {
        expect(serialized).not.toContain(forbiddenField);
      }
    });

    it('rejects a manipulated tenant header and exposes no tenant or secrets', async () => {
      const tenantA = await createTenant('public-a');
      const tenantB = await createTenant('public-b');
      const customerA = await createCustomer(tenantA.organizationId);
      const workOrder = await mustCreateWorkOrder(tenantA, customerA.id);

      const manipulated = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${workOrder.id}`,
        headers: headers(tenantA.accessToken, tenantB.organizationId),
      });
      expect(manipulated.statusCode).toBe(403);

      const serialized = JSON.stringify(workOrder);
      expect(serialized).not.toContain('organizationId');
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('sessions');
      expect(serialized).not.toContain('refreshToken');
    });
  });
});
