import { apiRequest } from './api-client';
import type {
  PaginatedResponse,
  WorkOrder,
  WorkOrderPriority,
  WorkOrderStatus,
} from './types';

export interface ListWorkOrdersParams {
  search?: string;
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  page?: number;
  limit?: number;
}

export interface CreateWorkOrderInput {
  customerId: string;
  assetId?: string | null;
  title: string;
  description?: string | null;
  priority?: WorkOrderPriority;
}

export interface UpdateWorkOrderInput {
  customerId?: string;
  assetId?: string | null;
  title?: string;
  description?: string | null;
  priority?: WorkOrderPriority;
  assignedToMembershipId?: string | null;
  scheduledAt?: string | null;
}

function toQuery(params: ListWorkOrdersParams): string {
  const search = new URLSearchParams();
  if (params.search !== undefined && params.search !== '') {
    search.set('search', params.search);
  }
  if (params.status !== undefined) {
    search.set('status', params.status);
  }
  if (params.priority !== undefined) {
    search.set('priority', params.priority);
  }
  if (params.page !== undefined) {
    search.set('page', String(params.page));
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

function buildUpdateWorkOrderBody(
  input: UpdateWorkOrderInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (input.customerId !== undefined) {
    body.customerId = input.customerId;
  }
  if (input.assetId !== undefined) {
    body.assetId = input.assetId;
  }
  if (input.title !== undefined) {
    body.title = input.title.trim();
  }
  if (input.description !== undefined) {
    body.description =
      input.description === null ? null : input.description.trim() || null;
  }
  if (input.priority !== undefined) {
    body.priority = input.priority;
  }
  if (input.assignedToMembershipId !== undefined) {
    body.assignedToMembershipId = input.assignedToMembershipId;
  }
  if (input.scheduledAt !== undefined) {
    body.scheduledAt = input.scheduledAt;
  }

  return body;
}

export async function listWorkOrdersRequest(
  params: ListWorkOrdersParams = {},
): Promise<PaginatedResponse<WorkOrder>> {
  return apiRequest<PaginatedResponse<WorkOrder>>(
    `/api/work-orders${toQuery(params)}`,
    { method: 'GET' },
  );
}

export async function getWorkOrder(id: string): Promise<WorkOrder> {
  return apiRequest<WorkOrder>(`/api/work-orders/${id}`, { method: 'GET' });
}

export async function createWorkOrderRequest(
  input: CreateWorkOrderInput,
): Promise<WorkOrder> {
  return apiRequest<WorkOrder>('/api/work-orders', {
    method: 'POST',
    body: input,
  });
}

export async function updateWorkOrder(
  id: string,
  input: UpdateWorkOrderInput,
): Promise<WorkOrder> {
  return apiRequest<WorkOrder>(`/api/work-orders/${id}`, {
    method: 'PATCH',
    body: buildUpdateWorkOrderBody(input),
  });
}

export async function changeWorkOrderStatus(
  id: string,
  status: WorkOrderStatus,
): Promise<WorkOrder> {
  return apiRequest<WorkOrder>(`/api/work-orders/${id}/status`, {
    method: 'POST',
    body: { status },
  });
}
