import { Decimal } from 'decimal.js';

import type { Prisma } from '../../generated/prisma/client.js';
import type { EstimateStatus } from '../../generated/prisma/enums.js';
import { prisma } from '../../lib/prisma.js';
import {
  calculateEstimateItem,
  calculateEstimateTotals,
  serializeMoney,
  serializePercent,
  serializeQuantity,
  type CalculatedEstimateItem,
} from './estimate.money.js';
import type {
  CreateEstimateBody,
  EstimateItemInput,
  ListEstimatesQuery,
  UpdateEstimateBody,
  UpdateEstimateItemBody,
  UpdateEstimateStatusBody,
} from './estimate.schemas.js';

export class EstimateWorkOrderNotFoundError extends Error {
  constructor() {
    super('Work order not found');
    this.name = 'EstimateWorkOrderNotFoundError';
  }
}

export class EstimateWorkOrderClosedError extends Error {
  constructor() {
    super('Work order is closed');
    this.name = 'EstimateWorkOrderClosedError';
  }
}

export class EstimateNotFoundError extends Error {
  constructor() {
    super('Estimate not found');
    this.name = 'EstimateNotFoundError';
  }
}

export class EstimateLockedError extends Error {
  constructor() {
    super('Estimate is locked');
    this.name = 'EstimateLockedError';
  }
}

export class EstimateItemNotFoundError extends Error {
  constructor() {
    super('Estimate item not found');
    this.name = 'EstimateItemNotFoundError';
  }
}

export class EstimateHasNoItemsError extends Error {
  constructor() {
    super('Estimate has no items');
    this.name = 'EstimateHasNoItemsError';
  }
}

export class InvalidEstimateStatusTransitionError extends Error {
  constructor() {
    super('Invalid estimate status transition');
    this.name = 'InvalidEstimateStatusTransitionError';
  }
}

export class InvalidEstimateMembershipError extends Error {
  constructor() {
    super('Invalid membership');
    this.name = 'InvalidEstimateMembershipError';
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

const publicEstimateItemSelect = {
  id: true,
  type: true,
  description: true,
  quantity: true,
  unitPrice: true,
  discountPercent: true,
  taxPercent: true,
  subtotal: true,
  discountAmount: true,
  taxableAmount: true,
  taxAmount: true,
  total: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

const publicEstimateDetailSelect = {
  id: true,
  number: true,
  status: true,
  currency: true,
  notes: true,
  terms: true,
  validUntil: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  sentAt: true,
  approvedAt: true,
  rejectedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  workOrder: {
    select: {
      id: true,
      number: true,
      title: true,
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
          identifier: true,
        },
      },
    },
  },
  createdBy: { select: membershipSummarySelect },
  items: {
    orderBy: { sortOrder: 'asc' as const },
    select: publicEstimateItemSelect,
  },
} as const;

const publicEstimateSummarySelect = {
  id: true,
  number: true,
  status: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  validUntil: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EstimateItemRecord = Prisma.EstimateItemGetPayload<{
  select: typeof publicEstimateItemSelect;
}>;

type EstimateDetailRecord = Prisma.EstimateGetPayload<{
  select: typeof publicEstimateDetailSelect;
}>;

type EstimateSummaryRecord = Prisma.EstimateGetPayload<{
  select: typeof publicEstimateSummarySelect;
}>;

function toPublicEstimateItem(item: EstimateItemRecord) {
  return {
    ...item,
    quantity: serializeQuantity(item.quantity.toString()),
    unitPrice: serializeMoney(item.unitPrice.toString()),
    discountPercent: serializePercent(item.discountPercent.toString()),
    taxPercent: serializePercent(item.taxPercent.toString()),
    subtotal: serializeMoney(item.subtotal.toString()),
    discountAmount: serializeMoney(item.discountAmount.toString()),
    taxableAmount: serializeMoney(item.taxableAmount.toString()),
    taxAmount: serializeMoney(item.taxAmount.toString()),
    total: serializeMoney(item.total.toString()),
  };
}

function toPublicEstimateDetail(estimate: EstimateDetailRecord) {
  const { createdBy, items, ...fields } = estimate;

  return {
    ...fields,
    subtotal: serializeMoney(estimate.subtotal.toString()),
    discountTotal: serializeMoney(estimate.discountTotal.toString()),
    taxTotal: serializeMoney(estimate.taxTotal.toString()),
    total: serializeMoney(estimate.total.toString()),
    createdBy: {
      membershipId: createdBy.id,
      user: createdBy.user,
    },
    items: items.map(toPublicEstimateItem),
  };
}

function toPublicEstimateSummary(estimate: EstimateSummaryRecord) {
  return {
    ...estimate,
    subtotal: serializeMoney(estimate.subtotal.toString()),
    discountTotal: serializeMoney(estimate.discountTotal.toString()),
    taxTotal: serializeMoney(estimate.taxTotal.toString()),
    total: serializeMoney(estimate.total.toString()),
  };
}

function calculatedItemData(
  input: EstimateItemInput,
  calculated: CalculatedEstimateItem,
) {
  return {
    type: input.type,
    description: input.description,
    quantity: calculated.quantity,
    unitPrice: calculated.unitPrice,
    discountPercent: calculated.discountPercent,
    taxPercent: calculated.taxPercent,
    subtotal: calculated.subtotal,
    discountAmount: calculated.discountAmount,
    taxableAmount: calculated.taxableAmount,
    taxAmount: calculated.taxAmount,
    total: calculated.total,
  };
}

async function requireWorkOrder(
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
    throw new EstimateWorkOrderNotFoundError();
  }
  if (
    mustBeOpen &&
    (workOrder.status === 'COMPLETED' ||
      workOrder.status === 'CANCELLED')
  ) {
    throw new EstimateWorkOrderClosedError();
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
    throw new InvalidEstimateMembershipError();
  }
}

async function lockEstimate(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  estimateId: string,
) {
  const locked = await transaction.estimate.updateMany({
    where: {
      id: estimateId,
      organizationId,
    },
    data: {
      nextItemOrder: { increment: 0 },
    },
  });

  if (locked.count !== 1) {
    throw new EstimateNotFoundError();
  }

  return transaction.estimate.findFirstOrThrow({
    where: {
      id: estimateId,
      organizationId,
    },
    select: {
      id: true,
      status: true,
      total: true,
      workOrder: { select: { status: true } },
    },
  });
}

async function requireMutableEstimate(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  estimateId: string,
) {
  const estimate = await lockEstimate(
    transaction,
    organizationId,
    estimateId,
  );

  if (estimate.status !== 'DRAFT') {
    throw new EstimateLockedError();
  }
  if (
    estimate.workOrder.status === 'COMPLETED' ||
    estimate.workOrder.status === 'CANCELLED'
  ) {
    throw new EstimateWorkOrderClosedError();
  }

  return estimate;
}

async function recalculateEstimateTotals(
  transaction: Prisma.TransactionClient,
  estimateId: string,
): Promise<void> {
  const items = await transaction.estimateItem.findMany({
    where: { estimateId },
    select: {
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      total: true,
    },
  });
  const totals = calculateEstimateTotals(
    items.map((item) => ({
      subtotal: item.subtotal.toString(),
      discountAmount: item.discountAmount.toString(),
      taxAmount: item.taxAmount.toString(),
      total: item.total.toString(),
    })),
  );

  await transaction.estimate.update({
    where: { id: estimateId },
    data: totals,
  });
}

async function getEstimateDetailWithTransaction(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  estimateId: string,
) {
  const estimate = await transaction.estimate.findFirst({
    where: {
      id: estimateId,
      organizationId,
    },
    select: publicEstimateDetailSelect,
  });

  return estimate === null ? null : toPublicEstimateDetail(estimate);
}

export async function createEstimate(
  organizationId: string,
  workOrderId: string,
  createdByMembershipId: string,
  input: CreateEstimateBody,
) {
  const calculatedItems = input.items.map((item) => ({
    input: item,
    calculated: calculateEstimateItem(item),
  }));
  const totals = calculateEstimateTotals(
    calculatedItems.map(({ calculated }) => calculated),
  );

  return prisma.$transaction(
    async (transaction) => {
      await requireWorkOrder(
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

      const organization = await transaction.organization.update({
        where: { id: organizationId },
        data: {
          nextEstimateNumber: { increment: 1 },
        },
        select: { nextEstimateNumber: true },
      });

      const estimate = await transaction.estimate.create({
        data: {
          organizationId,
          workOrderId,
          number: organization.nextEstimateNumber - 1,
          currency: input.currency,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          validUntil: input.validUntil ?? null,
          ...totals,
          nextItemOrder: calculatedItems.length + 1,
          createdByMembershipId,
          items: {
            create: calculatedItems.map(({ input: item, calculated }, index) => ({
              ...calculatedItemData(item, calculated),
              sortOrder: index + 1,
            })),
          },
        },
        select: publicEstimateDetailSelect,
      });

      return toPublicEstimateDetail(estimate);
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

export async function listEstimatesForWorkOrder(
  organizationId: string,
  workOrderId: string,
  query: ListEstimatesQuery,
) {
  return prisma.$transaction(async (transaction) => {
    await requireWorkOrder(
      transaction,
      organizationId,
      workOrderId,
      false,
    );

    const where: Prisma.EstimateWhereInput = {
      organizationId,
      workOrderId,
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const estimates = await transaction.estimate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: publicEstimateSummarySelect,
    });
    const total = await transaction.estimate.count({ where });

    return {
      data: estimates.map(toPublicEstimateSummary),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });
}

export async function getEstimateById(
  organizationId: string,
  estimateId: string,
) {
  const estimate = await prisma.estimate.findFirst({
    where: {
      id: estimateId,
      organizationId,
    },
    select: publicEstimateDetailSelect,
  });

  return estimate === null ? null : toPublicEstimateDetail(estimate);
}

export async function updateEstimate(
  organizationId: string,
  estimateId: string,
  input: UpdateEstimateBody,
) {
  return prisma.$transaction(async (transaction) => {
    await requireMutableEstimate(transaction, organizationId, estimateId);

    const data: Prisma.EstimateUpdateManyMutationInput = {};
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.terms !== undefined) data.terms = input.terms;
    if (input.validUntil !== undefined) data.validUntil = input.validUntil;

    const result = await transaction.estimate.updateMany({
      where: {
        id: estimateId,
        organizationId,
        status: 'DRAFT',
      },
      data,
    });
    if (result.count !== 1) {
      throw new EstimateLockedError();
    }

    return getEstimateDetailWithTransaction(
      transaction,
      organizationId,
      estimateId,
    );
  });
}

export async function addEstimateItem(
  organizationId: string,
  estimateId: string,
  input: EstimateItemInput,
) {
  const calculated = calculateEstimateItem(input);

  return prisma.$transaction(
    async (transaction) => {
      await requireMutableEstimate(transaction, organizationId, estimateId);

      const counter = await transaction.estimate.update({
        where: { id: estimateId },
        data: { nextItemOrder: { increment: 1 } },
        select: { nextItemOrder: true },
      });
      const item = await transaction.estimateItem.create({
        data: {
          estimateId,
          ...calculatedItemData(input, calculated),
          sortOrder: counter.nextItemOrder - 1,
        },
        select: publicEstimateItemSelect,
      });
      await recalculateEstimateTotals(transaction, estimateId);

      return toPublicEstimateItem(item);
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

export async function updateEstimateItem(
  organizationId: string,
  estimateId: string,
  itemId: string,
  input: UpdateEstimateItemBody,
) {
  return prisma.$transaction(async (transaction) => {
    await requireMutableEstimate(transaction, organizationId, estimateId);

    const existing = await transaction.estimateItem.findFirst({
      where: {
        id: itemId,
        estimateId,
      },
      select: {
        type: true,
        description: true,
        quantity: true,
        unitPrice: true,
        discountPercent: true,
        taxPercent: true,
      },
    });
    if (existing === null) {
      throw new EstimateItemNotFoundError();
    }

    const merged: EstimateItemInput = {
      type: input.type ?? existing.type,
      description: input.description ?? existing.description,
      quantity: input.quantity ?? existing.quantity.toString(),
      unitPrice: input.unitPrice ?? existing.unitPrice.toString(),
      discountPercent:
        input.discountPercent ?? existing.discountPercent.toString(),
      taxPercent: input.taxPercent ?? existing.taxPercent.toString(),
    };
    const calculated = calculateEstimateItem(merged);
    const item = await transaction.estimateItem.update({
      where: { id: itemId },
      data: calculatedItemData(merged, calculated),
      select: publicEstimateItemSelect,
    });
    await recalculateEstimateTotals(transaction, estimateId);

    return toPublicEstimateItem(item);
  });
}

export async function deleteEstimateItem(
  organizationId: string,
  estimateId: string,
  itemId: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await requireMutableEstimate(transaction, organizationId, estimateId);

    const result = await transaction.estimateItem.deleteMany({
      where: {
        id: itemId,
        estimateId,
      },
    });
    if (result.count !== 1) {
      throw new EstimateItemNotFoundError();
    }

    await recalculateEstimateTotals(transaction, estimateId);
  });
}

const allowedTransitions: Record<EstimateStatus, readonly EstimateStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export async function updateEstimateStatus(
  organizationId: string,
  estimateId: string,
  input: UpdateEstimateStatusBody,
) {
  return prisma.$transaction(async (transaction) => {
    const estimate = await lockEstimate(
      transaction,
      organizationId,
      estimateId,
    );

    if (
      estimate.workOrder.status === 'COMPLETED' ||
      estimate.workOrder.status === 'CANCELLED'
    ) {
      throw new EstimateWorkOrderClosedError();
    }

    if (estimate.status === input.status) {
      return getEstimateDetailWithTransaction(
        transaction,
        organizationId,
        estimateId,
      );
    }

    if (!allowedTransitions[estimate.status].includes(input.status)) {
      throw new InvalidEstimateStatusTransitionError();
    }

    if (estimate.status === 'DRAFT' && input.status === 'SENT') {
      const itemCount = await transaction.estimateItem.count({
        where: { estimateId },
      });
      if (itemCount === 0) {
        throw new EstimateHasNoItemsError();
      }
      if (new Decimal(estimate.total.toString()).lessThan(0)) {
        throw new InvalidEstimateStatusTransitionError();
      }
    }

    const now = new Date();
    const timestamp =
      input.status === 'SENT'
        ? { sentAt: now }
        : input.status === 'APPROVED'
          ? { approvedAt: now }
          : input.status === 'REJECTED'
            ? { rejectedAt: now }
            : { cancelledAt: now };

    const result = await transaction.estimate.updateMany({
      where: {
        id: estimateId,
        organizationId,
        status: estimate.status,
      },
      data: {
        status: input.status,
        ...timestamp,
      },
    });
    if (result.count !== 1) {
      throw new InvalidEstimateStatusTransitionError();
    }

    return getEstimateDetailWithTransaction(
      transaction,
      organizationId,
      estimateId,
    );
  });
}
