import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type {
  InspectionItemCondition,
  InspectionStatus,
  OrganizationRole,
  WorkOrderStatus,
} from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';

interface TenantIdentity {
  organizationId: string;
  membershipId: string;
  accessToken: string;
}

interface InspectionItemResponse {
  id: string;
  label: string;
  description: string | null;
  condition: InspectionItemCondition | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface InspectionResponse {
  id: string;
  title: string;
  notes: string | null;
  status: InspectionStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workOrder: { id: string; number: number; title: string };
  createdBy: {
    membershipId: string;
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    };
  };
  completedBy: {
    membershipId: string;
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    };
  } | null;
  items: InspectionItemResponse[];
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

describe('inspections API', () => {
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
      organizationId: organization.id,
      membershipId: membership.id,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createCustomer(organizationId: string) {
    return prisma.customer.create({
      data: {
        organizationId,
        name: unique('Customer'),
      },
      select: { id: true },
    });
  }

  async function createWorkOrder(
    tenant: TenantIdentity,
    status: WorkOrderStatus = 'OPEN',
  ) {
    const customer = await createCustomer(tenant.organizationId);

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
          status,
          createdByMembershipId: tenant.membershipId,
          ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
        select: { id: true, number: true, title: true },
      });
    });
  }

  async function postInspection(
    tenant: TenantIdentity,
    workOrderId: string,
    body: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrderId}/inspections`,
      headers: headers(tenant.accessToken, tenant.organizationId),
      payload: {
        title: unique('Inspection'),
        ...body,
      },
    });
  }

  async function mustCreateInspection(
    tenant: TenantIdentity,
    workOrderId: string,
    body: Record<string, unknown> = {},
  ): Promise<InspectionResponse> {
    const response = await postInspection(tenant, workOrderId, body);
    expect(response.statusCode).toBe(201);
    return response.json<InspectionResponse>();
  }

  async function addItem(
    tenant: TenantIdentity,
    inspectionId: string,
    body: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/inspections/${inspectionId}/items`,
      headers: headers(tenant.accessToken, tenant.organizationId),
      payload: {
        label: unique('Item'),
        ...body,
      },
    });
  }

  async function patchItem(
    tenant: TenantIdentity,
    inspectionId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'PATCH',
      url: `/api/inspections/${inspectionId}/items/${itemId}`,
      headers: headers(tenant.accessToken, tenant.organizationId),
      payload: body,
    });
  }

  async function complete(
    tenant: TenantIdentity,
    inspectionId: string,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/inspections/${inspectionId}/complete`,
      headers: headers(tenant.accessToken, tenant.organizationId),
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
    await prisma.inspectionItem.deleteMany();
    await prisma.inspection.deleteMany();
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
      '%s creates a DRAFT inspection with context creator',
      async (role) => {
        const tenant = await createTenant(`create-${role}`, role);
        const workOrder = await createWorkOrder(tenant);
        const response = await postInspection(tenant, workOrder.id, {
          title: '  Safety inspection  ',
          notes: 'Initial review',
          items: [
            { label: 'Brakes', description: 'Check pads' },
            { label: 'Lights' },
          ],
        });
        const body = response.json<InspectionResponse>();

        expect(response.statusCode).toBe(201);
        expect(body).toMatchObject({
          title: 'Safety inspection',
          notes: 'Initial review',
          status: 'DRAFT',
          completedAt: null,
          workOrder: { id: workOrder.id },
          createdBy: { membershipId: tenant.membershipId },
          completedBy: null,
        });
        expect(body.items.map((item) => item.sortOrder)).toEqual([1, 2]);
        expect(body.items.map((item) => item.condition)).toEqual([null, null]);
        expect(body).not.toHaveProperty('organizationId');
      },
    );

    it('hides cross-tenant and missing Work Orders', async () => {
      const tenantA = await createTenant('create-scope-a');
      const tenantB = await createTenant('create-scope-b');
      const workOrderB = await createWorkOrder(tenantB);

      for (const workOrderId of [workOrderB.id, randomUUID()]) {
        const response = await postInspection(tenantA, workOrderId);
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ message: 'Work order not found' });
      }
    });

    it.each(['COMPLETED', 'CANCELLED'] as const)(
      'rejects creation for a %s Work Order',
      async (status) => {
        const tenant = await createTenant(`closed-create-${status}`);
        const workOrder = await createWorkOrder(tenant, status);
        const response = await postInspection(tenant, workOrder.id);

        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: 'Work order is closed' });
      },
    );

    it('rejects server-controlled fields and tenant injection', async () => {
      const tenant = await createTenant('strict-create');
      const workOrder = await createWorkOrder(tenant);
      const response = await postInspection(tenant, workOrder.id, {
        organizationId: tenant.organizationId,
        workOrderId: workOrder.id,
        status: 'COMPLETED',
        createdByMembershipId: randomUUID(),
        completedByMembershipId: randomUUID(),
        completedAt: new Date().toISOString(),
        sortOrder: 99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: 'Invalid request body' });
      await expect(prisma.inspection.count()).resolves.toBe(0);
    });
  });

  describe('list and get', () => {
    it(
      'isolates tenants, filters status, and paginates with tenant total',
      async () => {
        const tenantA = await createTenant('list-a');
        const tenantB = await createTenant('list-b');
        const workOrderA = await createWorkOrder(tenantA);
        const workOrderB = await createWorkOrder(tenantB);
        const firstA = await mustCreateInspection(tenantA, workOrderA.id, {
          title: 'First A',
        });
        const secondA = await mustCreateInspection(tenantA, workOrderA.id, {
          title: 'Second A',
        });
        const thirdA = await mustCreateInspection(tenantA, workOrderA.id, {
          title: 'Third A',
        });
        const onlyB = await mustCreateInspection(tenantB, workOrderB.id, {
          title: 'Only B',
        });
        await prisma.inspection.update({
          where: { id: firstA.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedByMembershipId: tenantA.membershipId,
          },
        });

        const listA = await app.inject({
          method: 'GET',
          url: `/api/work-orders/${workOrderA.id}/inspections`,
          headers: headers(tenantA.accessToken, tenantA.organizationId),
        });
        const listB = await app.inject({
          method: 'GET',
          url: `/api/work-orders/${workOrderB.id}/inspections`,
          headers: headers(tenantB.accessToken, tenantB.organizationId),
        });
        const completedA = await app.inject({
          method: 'GET',
          url: `/api/work-orders/${workOrderA.id}/inspections?status=COMPLETED`,
          headers: headers(tenantA.accessToken, tenantA.organizationId),
        });
        const secondPage = await app.inject({
          method: 'GET',
          url: `/api/work-orders/${workOrderA.id}/inspections?page=2&limit=2`,
          headers: headers(tenantA.accessToken, tenantA.organizationId),
        });
        const bodyA = listA.json<{
          data: Array<{ id: string; itemCount: number }>;
          pagination: { page: number; limit: number; total: number };
        }>();

        expect(listA.statusCode).toBe(200);
        expect(bodyA.data.map((entry) => entry.id).sort()).toEqual(
          [firstA.id, secondA.id, thirdA.id].sort(),
        );
        expect(bodyA.data.every((entry) => entry.itemCount === 0)).toBe(true);
        expect(bodyA.pagination).toMatchObject({
          page: 1,
          limit: 20,
          total: 3,
        });
        expect(bodyA.data.some((entry) => entry.id === onlyB.id)).toBe(false);
        expect(
          listB.json<{ pagination: { total: number } }>().pagination.total,
        ).toBe(1);
        expect(
          completedA.json<{ data: Array<{ id: string }> }>().data,
        ).toEqual([expect.objectContaining({ id: firstA.id })]);
        expect(
          completedA.json<{ pagination: { total: number } }>().pagination.total,
        ).toBe(1);
        expect(secondPage.json<{ data: unknown[] }>().data).toHaveLength(1);
        expect(
          secondPage.json<{ pagination: { total: number } }>().pagination.total,
        ).toBe(3);
      },
      60_000,
    );

    it('returns 404 when listing a foreign Work Order', async () => {
      const tenantA = await createTenant('list-foreign-a');
      const tenantB = await createTenant('list-foreign-b');
      const workOrderB = await createWorkOrder(tenantB);
      const response = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${workOrderB.id}/inspections`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: 'Work order not found' });
    });

    it('gets an inspection with ordered items and safe public shapes', async () => {
      const tenant = await createTenant('get-own');
      const workOrder = await createWorkOrder(tenant);
      const created = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'First' }, { label: 'Second' }],
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/inspections/${created.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const body = response.json<InspectionResponse>();

      expect(response.statusCode).toBe(200);
      expect(body.items.map((item) => item.sortOrder)).toEqual([1, 2]);
      expect(Object.keys(body.workOrder).sort()).toEqual(
        ['id', 'number', 'title'].sort(),
      );
      expect(Object.keys(body.createdBy).sort()).toEqual(
        ['membershipId', 'user'].sort(),
      );
      expect(Object.keys(body.createdBy.user).sort()).toEqual(
        ['id', 'email', 'firstName', 'lastName'].sort(),
      );
      expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
        [
          'id',
          'label',
          'description',
          'condition',
          'notes',
          'sortOrder',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      const serialized = JSON.stringify(body);
      for (const forbidden of [
        'organizationId',
        'passwordHash',
        'AuthSession',
        'RefreshToken',
        'tokenHash',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('hides foreign and missing inspections', async () => {
      const tenantA = await createTenant('get-scope-a');
      const tenantB = await createTenant('get-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const inspectionA = await mustCreateInspection(tenantA, workOrderA.id);

      for (const inspectionId of [inspectionA.id, randomUUID()]) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/inspections/${inspectionId}`,
          headers:
            inspectionId === inspectionA.id
              ? headers(tenantB.accessToken, tenantB.organizationId)
              : headers(tenantA.accessToken, tenantA.organizationId),
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ message: 'Inspection not found' });
      }
    });
  });

  describe('draft mutations and items', () => {
    it('updates draft metadata and rejects server-controlled fields', async () => {
      const tenant = await createTenant('patch-draft');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id);
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/inspections/${inspection.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { title: 'Updated inspection', notes: 'Updated notes' },
      });
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/inspections/${inspection.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: {
          status: 'COMPLETED',
          workOrderId: workOrder.id,
          organizationId: tenant.organizationId,
          completedAt: new Date().toISOString(),
        },
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        title: 'Updated inspection',
        notes: 'Updated notes',
      });
      expect(invalid.statusCode).toBe(400);
    });

    it('hides cross-tenant inspection updates', async () => {
      const tenantA = await createTenant('patch-scope-a');
      const tenantB = await createTenant('patch-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const inspectionA = await mustCreateInspection(tenantA, workOrderA.id);
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/inspections/${inspectionA.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
        payload: { title: 'Forbidden update' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: 'Inspection not found' });
    });

    it('adds, edits, clears, and deletes an item while DRAFT', async () => {
      const tenant = await createTenant('item-crud');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id);
      const added = await addItem(tenant, inspection.id, {
        label: '  Tires  ',
        description: 'Inspect tread',
      });
      const item = added.json<InspectionItemResponse>();

      expect(added.statusCode).toBe(201);
      expect(item).toMatchObject({
        label: 'Tires',
        description: 'Inspect tread',
        condition: null,
        sortOrder: 1,
      });

      const edited = await patchItem(tenant, inspection.id, item.id, {
        label: 'Front tires',
        condition: 'ATTENTION',
        notes: 'Low tread',
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({
        label: 'Front tires',
        condition: 'ATTENTION',
        notes: 'Low tread',
      });

      const cleared = await patchItem(tenant, inspection.id, item.id, {
        condition: null,
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({ condition: null });

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/inspections/${inspection.id}/items/${item.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      expect(deleted.statusCode).toBe(204);
      await expect(
        prisma.inspectionItem.findUnique({ where: { id: item.id } }),
      ).resolves.toBeNull();
    });

    it.each([
      'OK',
      'ATTENTION',
      'FAIL',
      'NOT_APPLICABLE',
    ] as const)('accepts item condition %s', async (condition) => {
      const tenant = await createTenant(`condition-${condition}`);
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'Condition item' }],
      });
      const response = await patchItem(
        tenant,
        inspection.id,
        inspection.items[0]!.id,
        { condition },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ condition });
    });

    it('allocates unique sortOrder values under concurrent adds', async () => {
      const tenant = await createTenant('item-concurrency');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id);

      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          addItem(tenant, inspection.id, { label: `Concurrent ${index}` }),
        ),
      );
      const orders = responses
        .map((response) => response.json<InspectionItemResponse>().sortOrder)
        .sort((left, right) => left - right);

      expect(responses.map((response) => response.statusCode)).toEqual(
        Array.from({ length: 8 }, () => 201),
      );
      expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(new Set(orders).size).toBe(8);
    }, 60_000);

    it('never authorizes an item through another Inspection ID', async () => {
      const tenant = await createTenant('item-parent');
      const workOrder = await createWorkOrder(tenant);
      const first = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'First item' }],
      });
      const second = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'Second item' }],
      });
      const foreignItem = second.items[0]!;

      const patchResponse = await patchItem(
        tenant,
        first.id,
        foreignItem.id,
        { condition: 'OK' },
      );
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/inspections/${first.id}/items/${foreignItem.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(patchResponse.statusCode).toBe(404);
      expect(patchResponse.json()).toEqual({
        message: 'Inspection item not found',
      });
      expect(deleteResponse.statusCode).toBe(404);
      expect(deleteResponse.json()).toEqual({
        message: 'Inspection item not found',
      });
      await expect(
        prisma.inspectionItem.findUnique({
          where: { id: foreignItem.id },
          select: { condition: true },
        }),
      ).resolves.toEqual({ condition: null });
    });

    it('hides items behind a cross-tenant Inspection', async () => {
      const tenantA = await createTenant('item-scope-a');
      const tenantB = await createTenant('item-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const inspectionA = await mustCreateInspection(
        tenantA,
        workOrderA.id,
        { items: [{ label: 'Private item' }] },
      );
      const response = await patchItem(
        tenantB,
        inspectionA.id,
        inspectionA.items[0]!.id,
        { condition: 'OK' },
      );

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: 'Inspection not found' });
    });
  });

  describe('completion and closed parents', () => {
    it('rejects completion with no items', async () => {
      const tenant = await createTenant('complete-empty');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id);
      const response = await complete(tenant, inspection.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: 'Inspection has no items' });
    });

    it('rejects completion with incomplete items', async () => {
      const tenant = await createTenant('complete-incomplete');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'Unchecked' }],
      });
      const response = await complete(tenant, inspection.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        message: 'Inspection has incomplete items',
      });
    });

    it('completes once and keeps timestamp and completer idempotently', async () => {
      const tenant = await createTenant('complete-success');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'Evaluated' }],
      });
      await patchItem(
        tenant,
        inspection.id,
        inspection.items[0]!.id,
        { condition: 'OK' },
      );

      const first = await complete(tenant, inspection.id);
      const firstBody = first.json<InspectionResponse>();
      const repeated = await complete(tenant, inspection.id);
      const repeatedBody = repeated.json<InspectionResponse>();

      expect(first.statusCode).toBe(200);
      expect(firstBody.status).toBe('COMPLETED');
      expect(firstBody.completedAt).not.toBeNull();
      expect(firstBody.completedBy?.membershipId).toBe(tenant.membershipId);
      expect(repeated.statusCode).toBe(200);
      expect(repeatedBody.completedAt).toBe(firstBody.completedAt);
      expect(repeatedBody.completedBy).toEqual(firstBody.completedBy);
    });

    it('blocks every mutation after Inspection completion', async () => {
      const tenant = await createTenant('completed-mutations');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'Evaluated' }],
      });
      const itemId = inspection.items[0]!.id;
      await patchItem(tenant, inspection.id, itemId, { condition: 'OK' });
      await complete(tenant, inspection.id);

      const responses = [
        await app.inject({
          method: 'PATCH',
          url: `/api/inspections/${inspection.id}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
          payload: { title: 'Blocked' },
        }),
        await addItem(tenant, inspection.id),
        await patchItem(tenant, inspection.id, itemId, { condition: 'FAIL' }),
        await app.inject({
          method: 'DELETE',
          url: `/api/inspections/${inspection.id}/items/${itemId}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
        }),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({
          message: 'Inspection is completed',
        });
      }
    });

    it('keeps an Inspection readable but blocks draft mutations after Work Order closes', async () => {
      const tenant = await createTenant('closed-parent');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await mustCreateInspection(tenant, workOrder.id, {
        items: [{ label: 'Draft item' }],
      });
      const itemId = inspection.items[0]!.id;
      await prisma.workOrder.update({
        where: { id: workOrder.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      const mutations = [
        await app.inject({
          method: 'PATCH',
          url: `/api/inspections/${inspection.id}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
          payload: { title: 'Blocked' },
        }),
        await addItem(tenant, inspection.id),
        await patchItem(tenant, inspection.id, itemId, { condition: 'OK' }),
        await app.inject({
          method: 'DELETE',
          url: `/api/inspections/${inspection.id}/items/${itemId}`,
          headers: headers(tenant.accessToken, tenant.organizationId),
        }),
        await complete(tenant, inspection.id),
      ];
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/inspections/${inspection.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      for (const response of mutations) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: 'Work order is closed' });
      }
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toMatchObject({
        id: inspection.id,
        status: 'DRAFT',
      });
    });
  });

  describe('request security', () => {
    it('requires authentication and organization context', async () => {
      const tenant = await createTenant('inspection-context');
      const workOrder = await createWorkOrder(tenant);
      const anonymous = await app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/inspections`,
        payload: { title: 'Anonymous' },
      });
      const missingContext = await app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/inspections`,
        headers: headers(tenant.accessToken),
        payload: { title: 'Missing context' },
      });

      expect(anonymous.statusCode).toBe(401);
      expect(missingContext.statusCode).toBe(400);
    });
  });
});
