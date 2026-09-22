export type PublicEstimateStatus =
  | 'DRAFT'
  | 'SENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type PublicEstimateBlockedReason =
  | 'ESTIMATE_NOT_SENT'
  | 'ESTIMATE_EXPIRED'
  | 'WORK_ORDER_CLOSED'
  | null;

export interface PublicEstimateView {
  organization: { name: string };
  estimate: {
    number: number;
    status: PublicEstimateStatus;
    currency: string;
    validUntil: string | null;
    sentAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    cancelledAt: string | null;
    terms: string | null;
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
    canRespond: boolean;
    blockedReason: PublicEstimateBlockedReason;
  };
  workOrder: {
    number: number;
    customer: { name: string };
    asset: {
      name: string;
      plate: string | null;
      make: string | null;
      model: string | null;
    } | null;
  };
  items: PublicEstimateItem[];
}

export interface PublicEstimateItem {
  type: string;
  description: string;
  sortOrder: number;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
}

export interface PublicEstimateDecisionBody {
  decision: 'APPROVED' | 'REJECTED';
  responderName: string;
  rejectionReason?: string;
}

export type PublicEstimateApiErrorCode =
  | 'missing_token'
  | 'not_found'
  | 'expired'
  | 'conflict'
  | 'rate_limit'
  | 'validation'
  | 'network'
  | 'server';

export class PublicEstimateApiError extends Error {
  readonly code: PublicEstimateApiErrorCode;
  readonly status: number | null;

  constructor(
    code: PublicEstimateApiErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = 'PublicEstimateApiError';
    this.code = code;
    this.status = status;
  }
}
