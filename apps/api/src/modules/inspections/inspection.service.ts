import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type {
  AddInspectionItemBody,
  CreateInspectionBody,
  ListInspectionsQuery,
  UpdateInspectionBody,
  UpdateInspectionItemBody,
} from './inspection.schemas.js';

export class InspectionWorkOrderNotFoundError extends Error {
  constructor() {
    super('Work order not found');
    this.name = 'InspectionWorkOrderNotFoundError';
  }
}

export class InspectionWorkOrderClosedError extends Error {
  constructor() {
    super('Work order is closed');
    this.name = 'InspectionWorkOrderClosedError';
  }
}

export class InspectionNotFoundError extends Error {
  constructor() {
    super('Inspection not found');
    this.name = 'InspectionNotFoundError';
  }
}

export class InspectionCompletedError extends Error {
  constructor() {
    super('Inspection is completed');
    this.name = 'InspectionCompletedError';
  }
}

export class InspectionItemNotFoundError extends Error {
  constructor() {
    super('Inspection item not found');
    this.name = 'InspectionItemNotFoundError';
  }
}

export class InspectionItemHasMediaError extends Error {
  constructor() {
    super('Inspection item has media');
    this.name = 'InspectionItemHasMediaError';
  }
}

export class InspectionHasNoItemsError extends Error {
  constructor() {
    super('Inspection has no items');
    this.name = 'InspectionHasNoItemsError';
  }
}

export class InspectionHasIncompleteItemsError extends Error {
  constructor() {
    super('Inspection has incomplete items');
    this.name = 'InspectionHasIncompleteItemsError';
  }
}

export class InvalidInspectionMembershipError extends Error {
  constructor() {
    super('Invalid membership');
    this.name = 'InvalidInspectionMembershipError';
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

const publicInspectionItemSelect = {
  id: true,
  label: true,
  description: true,
  condition: true,
  notes: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

const publicInspectionDetailSelect = {
  id: true,
  title: true,
  notes: true,
  status: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  workOrder: {
    select: {
      id: true,
      number: true,
      title: true,
    },
  },
  createdBy: { select: membershipSummarySelect },
  completedBy: { select: membershipSummarySelect },
  items: {
    orderBy: { sortOrder: 'asc' as const },
    select: publicInspectionItemSelect,
  },
} as const;

const publicInspectionSummarySelect = {
  id: true,
  title: true,
  notes: true,
  status: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: membershipSummarySelect },
  completedBy: { select: membershipSummarySelect },
  _count: { select: { items: true } },
} as const;

type InspectionDetailRecord = Prisma.InspectionGetPayload<{
  select: typeof publicInspectionDetailSelect;
}>;

type InspectionSummaryRecord = Prisma.InspectionGetPayload<{
  select: typeof publicInspectionSummarySelect;
}>;

function membershipToPublic(
  membership: InspectionDetailRecord['createdBy'],
) {
  return {
    membershipId: membership.id,
    user: membership.user,
  };
}

function nullableMembershipToPublic(
  membership: InspectionDetailRecord['completedBy'],
) {
  return membership === null ? null : membershipToPublic(membership);
}

function toPublicInspectionDetail(inspection: InspectionDetailRecord) {
  const { createdBy, completedBy, ...fields } = inspection;

  return {
    ...fields,
    createdBy: membershipToPublic(createdBy),
    completedBy: nullableMembershipToPublic(completedBy),
  };
}

function toPublicInspectionSummary(inspection: InspectionSummaryRecord) {
  const { createdBy, completedBy, _count, ...fields } = inspection;

  return {
    ...fields,
    itemCount: _count.items,
    createdBy: membershipToPublic(createdBy),
    completedBy: nullableMembershipToPublic(completedBy),
  };
}

async function requireWorkOrderInOrganization(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  workOrderId: string,
  mustBeOpen: boolean,
) {
  const workOrder = await transaction.workOrder.findFirst({
    where: {
      id: workOrderId,
      organizationId,
    },
    select: { id: true, status: true },
  });

  if (workOrder === null) {
    throw new InspectionWorkOrderNotFoundError();
  }

  if (
    mustBeOpen &&
    (workOrder.status === 'COMPLETED' || workOrder.status === 'CANCELLED')
  ) {
    throw new InspectionWorkOrderClosedError();
  }

  return workOrder;
}

async function requireActiveMembership(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const membership = await transaction.organizationUser.findFirst({
    where: {
      id: membershipId,
      organizationId,
      active: true,
    },
    select: { id: true },
  });

  if (membership === null) {
    throw new InvalidInspectionMembershipError();
  }
}

async function requireMutableInspection(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  inspectionId: string,
) {
  const inspection = await transaction.inspection.findFirst({
    where: {
      id: inspectionId,
      organizationId,
    },
    select: {
      id: true,
      status: true,
      workOrder: { select: { status: true } },
    },
  });

  if (inspection === null) {
    throw new InspectionNotFoundError();
  }

  if (inspection.status === 'COMPLETED') {
    throw new InspectionCompletedError();
  }

  if (
    inspection.workOrder.status === 'COMPLETED' ||
    inspection.workOrder.status === 'CANCELLED'
  ) {
    throw new InspectionWorkOrderClosedError();
  }

  return inspection;
}

async function lockDraftInspection(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  inspectionId: string,
): Promise<void> {
  const result = await transaction.inspection.updateMany({
    where: {
      id: inspectionId,
      organizationId,
      status: 'DRAFT',
    },
    data: {
      nextItemOrder: { increment: 0 },
    },
  });

  if (result.count !== 1) {
    const current = await transaction.inspection.findFirst({
      where: { id: inspectionId, organizationId },
      select: { status: true },
    });

    if (current === null) {
      throw new InspectionNotFoundError();
    }

    throw new InspectionCompletedError();
  }
}

async function getInspectionDetailWithTransaction(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  inspectionId: string,
) {
  const inspection = await transaction.inspection.findFirst({
    where: {
      id: inspectionId,
      organizationId,
    },
    select: publicInspectionDetailSelect,
  });

  return inspection === null ? null : toPublicInspectionDetail(inspection);
}

export async function createInspection(
  organizationId: string,
  workOrderId: string,
  createdByMembershipId: string,
  input: CreateInspectionBody,
) {
  return prisma.$transaction(async (transaction) => {
    await requireWorkOrderInOrganization(
      transaction,
      organizationId,
      workOrderId,
      true,
    );
    await requireActiveMembership(
      transaction,
      organizationId,
      createdByMembershipId,
    );

    const inspection = await transaction.inspection.create({
      data: {
        organizationId,
        workOrderId,
        title: input.title,
        notes: input.notes ?? null,
        createdByMembershipId,
        nextItemOrder: input.items.length + 1,
        items: {
          create: input.items.map((item, index) => ({
            label: item.label,
            description: item.description ?? null,
            sortOrder: index + 1,
          })),
        },
      },
      select: publicInspectionDetailSelect,
    });

    return toPublicInspectionDetail(inspection);
  });
}

export async function listInspectionsForWorkOrder(
  organizationId: string,
  workOrderId: string,
  query: ListInspectionsQuery,
) {
  return prisma.$transaction(async (transaction) => {
    await requireWorkOrderInOrganization(
      transaction,
      organizationId,
      workOrderId,
      false,
    );

    const where: Prisma.InspectionWhereInput = {
      organizationId,
      workOrderId,
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const skip = (query.page - 1) * query.limit;
    const inspections = await transaction.inspection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
      select: publicInspectionSummarySelect,
    });
    const total = await transaction.inspection.count({ where });

    return {
      data: inspections.map(toPublicInspectionSummary),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });
}

export async function getInspectionById(
  organizationId: string,
  inspectionId: string,
) {
  const inspection = await prisma.inspection.findFirst({
    where: {
      id: inspectionId,
      organizationId,
    },
    select: publicInspectionDetailSelect,
  });

  return inspection === null ? null : toPublicInspectionDetail(inspection);
}

export async function updateInspection(
  organizationId: string,
  inspectionId: string,
  input: UpdateInspectionBody,
) {
  return prisma.$transaction(async (transaction) => {
    await requireMutableInspection(transaction, organizationId, inspectionId);

    const data: Prisma.InspectionUpdateManyMutationInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.notes !== undefined) data.notes = input.notes;

    const result = await transaction.inspection.updateMany({
      where: {
        id: inspectionId,
        organizationId,
        status: 'DRAFT',
      },
      data,
    });

    if (result.count !== 1) {
      throw new InspectionCompletedError();
    }

    return getInspectionDetailWithTransaction(
      transaction,
      organizationId,
      inspectionId,
    );
  });
}

export async function addInspectionItem(
  organizationId: string,
  inspectionId: string,
  input: AddInspectionItemBody,
) {
  return prisma.$transaction(
    async (transaction) => {
      await requireMutableInspection(
        transaction,
        organizationId,
        inspectionId,
      );

      const incremented = await transaction.inspection.updateMany({
        where: {
          id: inspectionId,
          organizationId,
          status: 'DRAFT',
        },
        data: {
          nextItemOrder: { increment: 1 },
        },
      });

      if (incremented.count !== 1) {
        throw new InspectionCompletedError();
      }

      const counter = await transaction.inspection.findFirstOrThrow({
        where: {
          id: inspectionId,
          organizationId,
        },
        select: { nextItemOrder: true },
      });

      return transaction.inspectionItem.create({
        data: {
          inspectionId,
          label: input.label,
          description: input.description ?? null,
          sortOrder: counter.nextItemOrder - 1,
        },
        select: publicInspectionItemSelect,
      });
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

export async function updateInspectionItem(
  organizationId: string,
  inspectionId: string,
  itemId: string,
  input: UpdateInspectionItemBody,
) {
  return prisma.$transaction(async (transaction) => {
    await requireMutableInspection(transaction, organizationId, inspectionId);
    await lockDraftInspection(transaction, organizationId, inspectionId);

    const data: Prisma.InspectionItemUpdateManyMutationInput = {};
    if (input.label !== undefined) data.label = input.label;
    if (input.description !== undefined) data.description = input.description;
    if (input.condition !== undefined) data.condition = input.condition;
    if (input.notes !== undefined) data.notes = input.notes;

    const result = await transaction.inspectionItem.updateMany({
      where: {
        id: itemId,
        inspectionId,
      },
      data,
    });

    if (result.count !== 1) {
      throw new InspectionItemNotFoundError();
    }

    return transaction.inspectionItem.findFirstOrThrow({
      where: {
        id: itemId,
        inspectionId,
      },
      select: publicInspectionItemSelect,
    });
  });
}

export async function deleteInspectionItem(
  organizationId: string,
  inspectionId: string,
  itemId: string,
) {
  return prisma.$transaction(async (transaction) => {
    await requireMutableInspection(transaction, organizationId, inspectionId);
    await lockDraftInspection(transaction, organizationId, inspectionId);

    const mediaCount = await transaction.media.count({
      where: {
        organizationId,
        inspectionItemId: itemId,
        inspectionItem: { is: { inspectionId } },
      },
    });

    if (mediaCount > 0) {
      throw new InspectionItemHasMediaError();
    }

    const result = await transaction.inspectionItem.deleteMany({
      where: {
        id: itemId,
        inspectionId,
      },
    });

    if (result.count !== 1) {
      throw new InspectionItemNotFoundError();
    }
  });
}

export async function completeInspection(
  organizationId: string,
  inspectionId: string,
  completedByMembershipId: string,
) {
  return prisma.$transaction(async (transaction) => {
    const initial = await transaction.inspection.findFirst({
      where: {
        id: inspectionId,
        organizationId,
      },
      select: { status: true },
    });

    if (initial === null) {
      throw new InspectionNotFoundError();
    }

    if (initial.status === 'COMPLETED') {
      return getInspectionDetailWithTransaction(
        transaction,
        organizationId,
        inspectionId,
      );
    }

    await lockDraftInspection(transaction, organizationId, inspectionId);

    const inspection = await transaction.inspection.findFirstOrThrow({
      where: {
        id: inspectionId,
        organizationId,
      },
      select: {
        workOrder: { select: { status: true } },
        items: { select: { condition: true } },
      },
    });

    if (
      inspection.workOrder.status === 'COMPLETED' ||
      inspection.workOrder.status === 'CANCELLED'
    ) {
      throw new InspectionWorkOrderClosedError();
    }

    if (inspection.items.length === 0) {
      throw new InspectionHasNoItemsError();
    }

    if (inspection.items.some((item) => item.condition === null)) {
      throw new InspectionHasIncompleteItemsError();
    }

    await requireActiveMembership(
      transaction,
      organizationId,
      completedByMembershipId,
    );

    const completedAt = new Date();
    const result = await transaction.inspection.updateMany({
      where: {
        id: inspectionId,
        organizationId,
        status: 'DRAFT',
      },
      data: {
        status: 'COMPLETED',
        completedAt,
        completedByMembershipId,
      },
    });

    if (result.count !== 1) {
      const current = await getInspectionDetailWithTransaction(
        transaction,
        organizationId,
        inspectionId,
      );

      if (current?.status === 'COMPLETED') {
        return current;
      }

      throw new InspectionCompletedError();
    }

    return getInspectionDetailWithTransaction(
      transaction,
      organizationId,
      inspectionId,
    );
  });
}
