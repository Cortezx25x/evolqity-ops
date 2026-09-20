import type { Prisma } from '../../generated/prisma/client.js';
import type {
  OrganizationRole,
  WorkOrderStatus,
} from '../../generated/prisma/enums.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateWorkOrderBody,
  ListWorkOrdersQuery,
  UpdateWorkOrderBody,
  UpdateWorkOrderStatusBody,
} from './work-order.schemas.js';

export class InvalidWorkOrderCustomerError extends Error {
  constructor() {
    super('Invalid customer');
    this.name = 'InvalidWorkOrderCustomerError';
  }
}

export class InvalidWorkOrderAssetError extends Error {
  constructor() {
    super('Invalid asset');
    this.name = 'InvalidWorkOrderAssetError';
  }
}

export class InvalidWorkOrderAssigneeError extends Error {
  constructor() {
    super('Invalid assignee');
    this.name = 'InvalidWorkOrderAssigneeError';
  }
}

export class InvalidWorkOrderCreatorError extends Error {
  constructor() {
    super('Invalid creator');
    this.name = 'InvalidWorkOrderCreatorError';
  }
}

export class WorkOrderClosedError extends Error {
  constructor() {
    super('Work order is closed');
    this.name = 'WorkOrderClosedError';
  }
}

export class InvalidWorkOrderStatusTransitionError extends Error {
  constructor() {
    super('Invalid status transition');
    this.name = 'InvalidWorkOrderStatusTransitionError';
  }
}

export class WorkOrderStatusForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'WorkOrderStatusForbiddenError';
  }
}

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

const membershipSummarySelect = {
  id: true,
  user: { select: userSummarySelect },
} as const;

const publicWorkOrderSelect = {
  id: true,
  number: true,
  status: true,
  priority: true,
  title: true,
  description: true,
  diagnosis: true,
  resolution: true,
  internalNotes: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      type: true,
    },
  },
  asset: {
    select: {
      id: true,
      name: true,
      type: true,
      plate: true,
      make: true,
      model: true,
    },
  },
  assignedTo: { select: membershipSummarySelect },
  createdBy: { select: membershipSummarySelect },
} as const;

type PublicWorkOrderRecord = Prisma.WorkOrderGetPayload<{
  select: typeof publicWorkOrderSelect;
}>;

function toPublicWorkOrder(workOrder: PublicWorkOrderRecord) {
  const { assignedTo, createdBy, ...fields } = workOrder;

  return {
    ...fields,
    assignedTo:
      assignedTo === null
        ? null
        : {
            membershipId: assignedTo.id,
            user: assignedTo.user,
          },
    createdBy: {
      membershipId: createdBy.id,
      user: createdBy.user,
    },
  };
}

async function requireActiveCustomer(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
): Promise<void> {
  const customer = await transaction.customer.findFirst({
    where: {
      id: customerId,
      organizationId,
      active: true,
    },
    select: { id: true },
  });

  if (customer === null) {
    throw new InvalidWorkOrderCustomerError();
  }
}

async function requireActiveAssetForCustomer(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  assetId: string,
): Promise<void> {
  const asset = await transaction.asset.findFirst({
    where: {
      id: assetId,
      organizationId,
      customerId,
      active: true,
    },
    select: { id: true },
  });

  if (asset === null) {
    throw new InvalidWorkOrderAssetError();
  }
}

async function requireActiveMembership(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string,
): Promise<boolean> {
  const membership = await transaction.organizationUser.findFirst({
    where: {
      id: membershipId,
      organizationId,
      active: true,
    },
    select: { id: true },
  });

  return membership !== null;
}

export async function createWorkOrder(
  organizationId: string,
  createdByMembershipId: string,
  input: CreateWorkOrderBody,
) {
  return prisma.$transaction(
    async (transaction) => {
      await requireActiveCustomer(
        transaction,
        organizationId,
        input.customerId,
      );

      if (input.assetId !== undefined && input.assetId !== null) {
        await requireActiveAssetForCustomer(
          transaction,
          organizationId,
          input.customerId,
          input.assetId,
        );
      }

      if (
        input.assignedToMembershipId !== undefined &&
        input.assignedToMembershipId !== null &&
        !(await requireActiveMembership(
          transaction,
          organizationId,
          input.assignedToMembershipId,
        ))
      ) {
        throw new InvalidWorkOrderAssigneeError();
      }

      if (
        !(await requireActiveMembership(
          transaction,
          organizationId,
          createdByMembershipId,
        ))
      ) {
        throw new InvalidWorkOrderCreatorError();
      }

      const organization = await transaction.organization.update({
        where: { id: organizationId },
        data: {
          nextWorkOrderNumber: { increment: 1 },
        },
        select: { nextWorkOrderNumber: true },
      });

      const workOrder = await transaction.workOrder.create({
        data: {
          organizationId,
          number: organization.nextWorkOrderNumber - 1,
          customerId: input.customerId,
          assetId: input.assetId ?? null,
          status: 'OPEN',
          priority: input.priority,
          title: input.title,
          description: input.description ?? null,
          diagnosis: input.diagnosis ?? null,
          internalNotes: input.internalNotes ?? null,
          assignedToMembershipId: input.assignedToMembershipId ?? null,
          createdByMembershipId,
          scheduledAt: input.scheduledAt ?? null,
        },
        select: publicWorkOrderSelect,
      });

      return toPublicWorkOrder(workOrder);
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

export async function listWorkOrders(
  organizationId: string,
  query: ListWorkOrdersQuery,
) {
  const numericSearch =
    query.search !== undefined && /^\d+$/.test(query.search)
      ? Number(query.search)
      : null;
  const searchableNumber =
    numericSearch !== null &&
    Number.isSafeInteger(numericSearch) &&
    numericSearch > 0
      ? numericSearch
      : null;

  const where: Prisma.WorkOrderWhereInput = {
    organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.priority === undefined ? {} : { priority: query.priority }),
    ...(query.customerId === undefined
      ? {}
      : { customerId: query.customerId }),
    ...(query.assetId === undefined ? {} : { assetId: query.assetId }),
    ...(query.assignedToMembershipId === undefined
      ? {}
      : { assignedToMembershipId: query.assignedToMembershipId }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { diagnosis: { contains: query.search, mode: 'insensitive' } },
            {
              customer: {
                is: {
                  organizationId,
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
            },
            {
              asset: {
                is: {
                  organizationId,
                  OR: [
                    { name: { contains: query.search, mode: 'insensitive' } },
                    { plate: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              },
            },
            ...(searchableNumber === null
              ? []
              : [{ number: searchableNumber }]),
          ],
        }),
  };
  const skip = (query.page - 1) * query.limit;
  const [records, total] = await prisma.$transaction([
    prisma.workOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
      select: publicWorkOrderSelect,
    }),
    prisma.workOrder.count({ where }),
  ]);

  return {
    data: records.map(toPublicWorkOrder),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getWorkOrderById(
  organizationId: string,
  workOrderId: string,
) {
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      organizationId,
    },
    select: publicWorkOrderSelect,
  });

  return workOrder === null ? null : toPublicWorkOrder(workOrder);
}

export async function updateWorkOrder(
  organizationId: string,
  workOrderId: string,
  input: UpdateWorkOrderBody,
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.workOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId,
      },
      select: {
        customerId: true,
        assetId: true,
        status: true,
      },
    });

    if (existing === null) {
      return null;
    }

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new WorkOrderClosedError();
    }

    const resultingCustomerId = input.customerId ?? existing.customerId;
    const resultingAssetId =
      input.assetId === undefined ? existing.assetId : input.assetId;
    const relationChanged =
      input.customerId !== undefined || input.assetId !== undefined;

    if (relationChanged) {
      await requireActiveCustomer(
        transaction,
        organizationId,
        resultingCustomerId,
      );
    }

    if (relationChanged && resultingAssetId !== null) {
      await requireActiveAssetForCustomer(
        transaction,
        organizationId,
        resultingCustomerId,
        resultingAssetId,
      );
    }

    if (
      input.assignedToMembershipId !== undefined &&
      input.assignedToMembershipId !== null &&
      !(await requireActiveMembership(
        transaction,
        organizationId,
        input.assignedToMembershipId,
      ))
    ) {
      throw new InvalidWorkOrderAssigneeError();
    }

    const data: Prisma.WorkOrderUncheckedUpdateManyInput = {};

    if (input.customerId !== undefined) data.customerId = input.customerId;
    if (input.assetId !== undefined) data.assetId = input.assetId;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.diagnosis !== undefined) data.diagnosis = input.diagnosis;
    if (input.resolution !== undefined) data.resolution = input.resolution;
    if (input.internalNotes !== undefined) {
      data.internalNotes = input.internalNotes;
    }
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.assignedToMembershipId !== undefined) {
      data.assignedToMembershipId = input.assignedToMembershipId;
    }
    if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;

    const result = await transaction.workOrder.updateMany({
      where: {
        id: workOrderId,
        organizationId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      data,
    });

    if (result.count !== 1) {
      const current = await transaction.workOrder.findFirst({
        where: { id: workOrderId, organizationId },
        select: { status: true },
      });

      if (
        current?.status === 'COMPLETED' ||
        current?.status === 'CANCELLED'
      ) {
        throw new WorkOrderClosedError();
      }

      return null;
    }

    const updated = await transaction.workOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId,
      },
      select: publicWorkOrderSelect,
    });

    return updated === null ? null : toPublicWorkOrder(updated);
  });
}

const allowedStatusTransitions: Record<
  WorkOrderStatus,
  ReadonlySet<WorkOrderStatus>
> = {
  DRAFT: new Set(['OPEN', 'CANCELLED']),
  OPEN: new Set(['IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED']),
  IN_PROGRESS: new Set(['WAITING', 'COMPLETED', 'CANCELLED']),
  WAITING: new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

const memberStatusTransitions = new Set([
  'OPEN:IN_PROGRESS',
  'OPEN:WAITING',
  'OPEN:COMPLETED',
  'IN_PROGRESS:WAITING',
  'IN_PROGRESS:COMPLETED',
  'WAITING:IN_PROGRESS',
  'WAITING:COMPLETED',
]);

export async function updateWorkOrderStatus(
  organizationId: string,
  workOrderId: string,
  role: OrganizationRole,
  input: UpdateWorkOrderStatusBody,
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.workOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId,
      },
      select: {
        status: true,
        startedAt: true,
      },
    });

    if (existing === null) {
      return null;
    }

    if (existing.status === input.status) {
      const unchanged = await transaction.workOrder.findFirst({
        where: { id: workOrderId, organizationId },
        select: publicWorkOrderSelect,
      });

      return unchanged === null ? null : toPublicWorkOrder(unchanged);
    }

    if (!allowedStatusTransitions[existing.status].has(input.status)) {
      throw new InvalidWorkOrderStatusTransitionError();
    }

    if (
      role === 'MEMBER' &&
      !memberStatusTransitions.has(`${existing.status}:${input.status}`)
    ) {
      throw new WorkOrderStatusForbiddenError();
    }

    const now = new Date();
    const data: Prisma.WorkOrderUpdateManyMutationInput = {
      status: input.status,
    };

    if (input.status === 'IN_PROGRESS' && existing.startedAt === null) {
      data.startedAt = now;
    }
    if (input.status === 'COMPLETED') {
      data.completedAt = now;
    }
    if (input.status === 'CANCELLED') {
      data.cancelledAt = now;
    }

    const result = await transaction.workOrder.updateMany({
      where: {
        id: workOrderId,
        organizationId,
        status: existing.status,
      },
      data,
    });

    if (result.count !== 1) {
      const current = await transaction.workOrder.findFirst({
        where: { id: workOrderId, organizationId },
        select: publicWorkOrderSelect,
      });

      if (current !== null && current.status === input.status) {
        return toPublicWorkOrder(current);
      }

      throw new InvalidWorkOrderStatusTransitionError();
    }

    const updated = await transaction.workOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId,
      },
      select: publicWorkOrderSelect,
    });

    return updated === null ? null : toPublicWorkOrder(updated);
  });
}
