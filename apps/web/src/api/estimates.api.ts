import { apiRequest } from './api-client';
import type { PaginatedResponse, WorkOrderMembershipSummary } from './types';

export type EstimateStatus =
  | 'DRAFT'
  | 'SENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type EstimateItemType = 'LABOR' | 'PART' | 'SERVICE' | 'OTHER';

export interface EstimateItem {
  id: string;
  type: EstimateItemType;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateSummary {
  id: string;
  number: number;
  status: EstimateStatus;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateDetail {
  id: string;
  number: number;
  status: EstimateStatus;
  currency: string;
  notes: string | null;
  terms: string | null;
  validUntil: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  sentAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  workOrder: {
    id: string;
    number: number;
    title: string;
    customer: {
      id: string;
      name: string;
      type: string;
    };
    asset: {
      id: string;
      name: string;
      type: string;
      identifier: string | null;
    } | null;
  };
  createdBy: {
    membershipId: string;
    user: WorkOrderMembershipSummary['user'];
  };
  items: EstimateItem[];
}

export interface ListEstimatesParams {
  status?: EstimateStatus;
  page?: number;
  limit?: number;
}

export interface CreateEstimateInput {
  currency: string;
  notes?: string | null;
  terms?: string | null;
  validUntil?: string | null;
  items?: Array<{
    type: EstimateItemType;
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent?: string;
    taxPercent?: string;
  }>;
}

export interface UpdateEstimateInput {
  currency?: string;
  notes?: string | null;
  terms?: string | null;
  validUntil?: string | null;
}

export interface EstimateItemInput {
  type: EstimateItemType;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  taxPercent?: string;
}

export type UpdateEstimateItemInput = Partial<EstimateItemInput>;

export type ChangeEstimateStatusInput = {
  status: 'SENT' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
};

export async function listEstimatesRequest(
  workOrderId: string,
  params: ListEstimatesParams = {},
): Promise<PaginatedResponse<EstimateSummary>> {
  const search = new URLSearchParams();
  if (params.status !== undefined) {
    search.set('status', params.status);
  }
  if (params.page !== undefined) {
    search.set('page', String(params.page));
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  const query = search.toString();
  return apiRequest<PaginatedResponse<EstimateSummary>>(
    `/api/work-orders/${workOrderId}/estimates${query ? `?${query}` : ''}`,
    { method: 'GET' },
  );
}

export async function getEstimateRequest(
  estimateId: string,
): Promise<EstimateDetail> {
  return apiRequest<EstimateDetail>(`/api/estimates/${estimateId}`, {
    method: 'GET',
  });
}

export async function createEstimateRequest(
  workOrderId: string,
  input: CreateEstimateInput,
): Promise<EstimateDetail> {
  return apiRequest<EstimateDetail>(
    `/api/work-orders/${workOrderId}/estimates`,
    {
      method: 'POST',
      body: input,
    },
  );
}

export async function updateEstimateRequest(
  estimateId: string,
  input: UpdateEstimateInput,
): Promise<EstimateDetail> {
  return apiRequest<EstimateDetail>(`/api/estimates/${estimateId}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function addEstimateItemRequest(
  estimateId: string,
  input: EstimateItemInput,
): Promise<EstimateItem> {
  return apiRequest<EstimateItem>(`/api/estimates/${estimateId}/items`, {
    method: 'POST',
    body: {
      type: input.type,
      description: input.description,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discountPercent: input.discountPercent ?? '0.00',
      taxPercent: input.taxPercent ?? '0.00',
    },
  });
}

export async function updateEstimateItemRequest(
  estimateId: string,
  itemId: string,
  input: UpdateEstimateItemInput,
): Promise<EstimateItem> {
  return apiRequest<EstimateItem>(
    `/api/estimates/${estimateId}/items/${itemId}`,
    {
      method: 'PATCH',
      body: input,
    },
  );
}

export async function deleteEstimateItemRequest(
  estimateId: string,
  itemId: string,
): Promise<void> {
  await apiRequest<void>(
    `/api/estimates/${estimateId}/items/${itemId}`,
    { method: 'DELETE' },
  );
}

export async function changeEstimateStatusRequest(
  estimateId: string,
  input: ChangeEstimateStatusInput,
): Promise<EstimateDetail> {
  return apiRequest<EstimateDetail>(`/api/estimates/${estimateId}/status`, {
    method: 'POST',
    body: input,
  });
}

export interface IssueEstimatePublicAccessResponse {
  publicUrl: string;
  expiresAt: string;
}

export async function issueEstimatePublicAccessRequest(
  estimateId: string,
): Promise<IssueEstimatePublicAccessResponse> {
  return apiRequest<IssueEstimatePublicAccessResponse>(
    `/api/estimates/${estimateId}/public-access`,
    { method: 'POST' },
  );
}

export async function revokeEstimatePublicAccessRequest(
  estimateId: string,
): Promise<void> {
  await apiRequest<void>(`/api/estimates/${estimateId}/public-access`, {
    method: 'DELETE',
  });
}
