import type { Prisma } from '../../generated/prisma/client.js';
import type { PublicEstimateDecision } from '../../generated/prisma/enums.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import {
  EstimateNotFoundError,
  EstimateWorkOrderClosedError,
} from '../estimates/estimate.service.js';
import {
  serializeMoney,
  serializePercent,
  serializeQuantity,
} from '../estimates/estimate.money.js';
import type { PublicEstimateDecisionBody } from './public-estimate.schemas.js';
import {
  buildPublicEstimateAccessUrl,
  generatePublicEstimateToken,
  hashPublicEstimateTokenSecret,
  verifyPublicEstimateTokenSecret,
} from './public-estimate.tokens.js';

export class PublicEstimateCapabilityNotFoundError extends Error {
  constructor() {
    super('Public estimate capability not found');
    this.name = 'PublicEstimateCapabilityNotFoundError';
  }
}

export class PublicEstimateCapabilityExpiredError extends Error {
  constructor() {
    super('Public estimate capability expired');
    this.name = 'PublicEstimateCapabilityExpiredError';
  }
}

export class PublicEstimateAccessNotAllowedError extends Error {
  constructor() {
    super('Public estimate access is not allowed');
    this.name = 'PublicEstimateAccessNotAllowedError';
  }
}

export class PublicEstimateDecisionConflictError extends Error {
  constructor() {
    super('Public estimate decision conflict');
    this.name = 'PublicEstimateDecisionConflictError';
  }
}

export class PublicEstimateDecisionNotAllowedError extends Error {
  constructor() {
    super('Public estimate decision is not allowed');
    this.name = 'PublicEstimateDecisionNotAllowedError';
  }
}

const publicViewEstimateSelect = {
  number: true,
  status: true,
  currency: true,
  validUntil: true,
  sentAt: true,
  approvedAt: true,
  rejectedAt: true,
  cancelledAt: true,
  terms: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  organizationId: true,
  workOrder: {
    select: {
      number: true,
      status: true,
      customer: { select: { name: true } },
      asset: {
        select: {
          name: true,
          plate: true,
          make: true,
          model: true,
        },
      },
    },
  },
  items: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      type: true,
      description: true,
      sortOrder: true,
      quantity: true,
      unitPrice: true,
      discountPercent: true,
      taxPercent: true,
      subtotal: true,
      discountAmount: true,
      taxableAmount: true,
      taxAmount: true,
      total: true,
    },
  },
} as const;

type PublicViewEstimateRecord = Prisma.EstimateGetPayload<{
  select: typeof publicViewEstimateSelect;
}>;

type VerifiedTokenContext = {
  tokenId: string;
  organizationId: string;
  estimateId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  decision: PublicEstimateDecision | null;
  organizationName: string;
  estimate: PublicViewEstimateRecord;
};

function publicTokenTtlMs(): number {
  return env.PUBLIC_ESTIMATE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function assertCapabilityNotExpired(expiresAt: Date, now: Date): void {
  if (expiresAt.getTime() <= now.getTime()) {
    throw new PublicEstimateCapabilityExpiredError();
  }
}

async function lockEstimateRow(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  estimateId: string,
): Promise<void> {
  const locked = await transaction.estimate.updateMany({
    where: { id: estimateId, organizationId },
    data: { nextItemOrder: { increment: 0 } },
  });

  if (locked.count !== 1) {
    throw new EstimateNotFoundError();
  }
}

async function revokeNonRevokedTokens(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  estimateId: string,
  revokedReason: string,
  revokedAt: Date,
): Promise<void> {
  await transaction.estimatePublicToken.updateMany({
    where: {
      organizationId,
      estimateId,
      revokedAt: null,
    },
    data: {
      revokedAt,
      revokedReason,
    },
  });
}

async function loadVerifiedToken(
  transaction: Prisma.TransactionClient,
  tokenId: string,
  secret: string,
): Promise<VerifiedTokenContext> {
  const token = await transaction.estimatePublicToken.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      organizationId: true,
      estimateId: true,
      secretHash: true,
      expiresAt: true,
      revokedAt: true,
      decision: true,
      organization: { select: { active: true, name: true } },
      estimate: { select: publicViewEstimateSelect },
    },
  });

  if (
    token === null ||
    !verifyPublicEstimateTokenSecret(secret, token.secretHash)
  ) {
    throw new PublicEstimateCapabilityNotFoundError();
  }

  if (
    token.estimate.organizationId !== token.organizationId ||
    !token.organization.active
  ) {
    throw new PublicEstimateCapabilityNotFoundError();
  }

  if (token.revokedAt !== null) {
    throw new PublicEstimateCapabilityNotFoundError();
  }

  return {
    tokenId: token.id,
    organizationId: token.organizationId,
    estimateId: token.estimateId,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    decision: token.decision,
    organizationName: token.organization.name,
    estimate: token.estimate,
  };
}

function evaluateRespondEligibility(
  estimate: PublicViewEstimateRecord,
  now: Date,
): { canRespond: boolean; blockedReason: string | null } {
  if (estimate.status !== 'SENT') {
    return { canRespond: false, blockedReason: 'ESTIMATE_NOT_SENT' };
  }

  if (
    estimate.validUntil !== null &&
    estimate.validUntil.getTime() <= now.getTime()
  ) {
    return { canRespond: false, blockedReason: 'ESTIMATE_EXPIRED' };
  }

  if (
    estimate.workOrder.status === 'COMPLETED' ||
    estimate.workOrder.status === 'CANCELLED'
  ) {
    return { canRespond: false, blockedReason: 'WORK_ORDER_CLOSED' };
  }

  return { canRespond: true, blockedReason: null };
}

function toPublicEstimateView(
  organizationName: string,
  estimate: PublicViewEstimateRecord,
  now: Date,
) {
  const { canRespond, blockedReason } = evaluateRespondEligibility(
    estimate,
    now,
  );

  return {
    organization: { name: organizationName },
    estimate: {
      number: estimate.number,
      status: estimate.status,
      currency: estimate.currency,
      validUntil: estimate.validUntil,
      sentAt: estimate.sentAt,
      approvedAt: estimate.approvedAt,
      rejectedAt: estimate.rejectedAt,
      cancelledAt: estimate.cancelledAt,
      terms: estimate.terms,
      subtotal: serializeMoney(estimate.subtotal.toString()),
      discountTotal: serializeMoney(estimate.discountTotal.toString()),
      taxTotal: serializeMoney(estimate.taxTotal.toString()),
      total: serializeMoney(estimate.total.toString()),
      canRespond,
      blockedReason,
    },
    workOrder: {
      number: estimate.workOrder.number,
      customer: { name: estimate.workOrder.customer.name },
      asset:
        estimate.workOrder.asset === null
          ? null
          : {
              name: estimate.workOrder.asset.name,
              plate: estimate.workOrder.asset.plate,
              make: estimate.workOrder.asset.make,
              model: estimate.workOrder.asset.model,
            },
    },
    items: estimate.items.map((item) => ({
      type: item.type,
      description: item.description,
      sortOrder: item.sortOrder,
      quantity: serializeQuantity(item.quantity.toString()),
      unitPrice: serializeMoney(item.unitPrice.toString()),
      discountPercent: serializePercent(item.discountPercent.toString()),
      taxPercent: serializePercent(item.taxPercent.toString()),
      subtotal: serializeMoney(item.subtotal.toString()),
      discountAmount: serializeMoney(item.discountAmount.toString()),
      taxableAmount: serializeMoney(item.taxableAmount.toString()),
      taxAmount: serializeMoney(item.taxAmount.toString()),
      total: serializeMoney(item.total.toString()),
    })),
  };
}

export async function issuePublicEstimateAccess(
  organizationId: string,
  estimateId: string,
  createdByMembershipId: string,
) {
  return prisma.$transaction(async (transaction) => {
    await lockEstimateRow(transaction, organizationId, estimateId);

    const estimate = await transaction.estimate.findFirst({
      where: { id: estimateId, organizationId },
      select: {
        status: true,
        workOrder: { select: { status: true } },
      },
    });

    if (estimate === null) {
      throw new EstimateNotFoundError();
    }

    if (estimate.status !== 'SENT') {
      throw new PublicEstimateAccessNotAllowedError();
    }

    if (
      estimate.workOrder.status === 'COMPLETED' ||
      estimate.workOrder.status === 'CANCELLED'
    ) {
      throw new EstimateWorkOrderClosedError();
    }

    const membership = await transaction.organizationUser.findFirst({
      where: {
        id: createdByMembershipId,
        organizationId,
        active: true,
      },
      select: { id: true },
    });
    if (membership === null) {
      throw new PublicEstimateAccessNotAllowedError();
    }

    const now = new Date();
    await revokeNonRevokedTokens(
      transaction,
      organizationId,
      estimateId,
      'rotated',
      now,
    );

    const generated = generatePublicEstimateToken();
    const expiresAt = new Date(now.getTime() + publicTokenTtlMs());

    await transaction.estimatePublicToken.create({
      data: {
        id: generated.tokenId,
        organizationId,
        estimateId,
        secretHash: Uint8Array.from(
          hashPublicEstimateTokenSecret(generated.secret),
        ),
        expiresAt,
        createdByMembershipId,
      },
    });

    return {
      publicUrl: buildPublicEstimateAccessUrl(generated.token),
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function revokePublicEstimateAccess(
  organizationId: string,
  estimateId: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const estimate = await transaction.estimate.findFirst({
      where: { id: estimateId, organizationId },
      select: { id: true },
    });

    if (estimate === null) {
      throw new EstimateNotFoundError();
    }

    await revokeNonRevokedTokens(
      transaction,
      organizationId,
      estimateId,
      'manual',
      new Date(),
    );
  });
}

export async function getPublicEstimateView(tokenId: string, secret: string) {
  return prisma.$transaction(async (transaction) => {
    const verified = await loadVerifiedToken(transaction, tokenId, secret);
    const now = new Date();
    assertCapabilityNotExpired(verified.expiresAt, now);

    return toPublicEstimateView(
      verified.organizationName,
      verified.estimate,
      now,
    );
  });
}

function decisionMatchesStatus(
  decision: PublicEstimateDecision,
  status: PublicViewEstimateRecord['status'],
): boolean {
  return (
    (decision === 'APPROVED' && status === 'APPROVED') ||
    (decision === 'REJECTED' && status === 'REJECTED')
  );
}

export async function submitPublicEstimateDecision(
  tokenId: string,
  secret: string,
  input: PublicEstimateDecisionBody,
) {
  return prisma.$transaction(async (transaction) => {
    const verified = await loadVerifiedToken(transaction, tokenId, secret);
    const now = new Date();
    assertCapabilityNotExpired(verified.expiresAt, now);

    const refreshedEstimate = await transaction.estimate.findFirst({
      where: {
        id: verified.estimateId,
        organizationId: verified.organizationId,
      },
      select: publicViewEstimateSelect,
    });

    if (refreshedEstimate === null) {
      throw new PublicEstimateCapabilityNotFoundError();
    }

    if (
      verified.decision !== null &&
      verified.decision === input.decision &&
      decisionMatchesStatus(input.decision, refreshedEstimate.status)
    ) {
      return toPublicEstimateView(
        verified.organizationName,
        refreshedEstimate,
        now,
      );
    }

    if (
      verified.decision !== null &&
      verified.decision !== input.decision
    ) {
      throw new PublicEstimateDecisionConflictError();
    }

    const { canRespond } = evaluateRespondEligibility(refreshedEstimate, now);
    if (!canRespond) {
      if (
        verified.decision !== null &&
        verified.decision === input.decision &&
        decisionMatchesStatus(input.decision, refreshedEstimate.status)
      ) {
        return toPublicEstimateView(
          verified.organizationName,
          refreshedEstimate,
          now,
        );
      }

      throw new PublicEstimateDecisionNotAllowedError();
    }

    const statusUpdate =
      input.decision === 'APPROVED'
        ? { status: 'APPROVED' as const, approvedAt: now }
        : { status: 'REJECTED' as const, rejectedAt: now };

    const estimateResult = await transaction.estimate.updateMany({
      where: {
        id: verified.estimateId,
        organizationId: verified.organizationId,
        status: 'SENT',
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        workOrder: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      },
      data: statusUpdate,
    });

    if (estimateResult.count === 1) {
      const tokenResult = await transaction.estimatePublicToken.updateMany({
        where: {
          id: verified.tokenId,
          organizationId: verified.organizationId,
          decision: null,
        },
        data: {
          decision: input.decision,
          decidedAt: now,
          responderName: input.responderName,
          rejectionReason:
            input.decision === 'REJECTED'
              ? (input.rejectionReason ?? null)
              : null,
        },
      });

      if (tokenResult.count !== 1) {
        throw new PublicEstimateDecisionConflictError();
      }
    } else {
      const currentEstimate = await transaction.estimate.findFirst({
        where: {
          id: verified.estimateId,
          organizationId: verified.organizationId,
        },
        select: publicViewEstimateSelect,
      });
      const currentToken = await transaction.estimatePublicToken.findUnique({
        where: { id: verified.tokenId },
        select: { decision: true },
      });

      if (
        currentEstimate !== null &&
        currentToken?.decision === input.decision &&
        decisionMatchesStatus(input.decision, currentEstimate.status)
      ) {
        return toPublicEstimateView(
          verified.organizationName,
          currentEstimate,
          now,
        );
      }

      throw new PublicEstimateDecisionConflictError();
    }

    const finalEstimate = await transaction.estimate.findFirstOrThrow({
      where: {
        id: verified.estimateId,
        organizationId: verified.organizationId,
      },
      select: publicViewEstimateSelect,
    });

    return toPublicEstimateView(
      verified.organizationName,
      finalEstimate,
      now,
    );
  });
}
