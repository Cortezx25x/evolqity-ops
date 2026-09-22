import { apiRequest } from './api-client';
import type { PaginatedResponse, WorkOrderMembershipSummary } from './types';

export type InspectionStatus = 'DRAFT' | 'COMPLETED';

export type InspectionItemCondition =
  | 'OK'
  | 'ATTENTION'
  | 'FAIL'
  | 'NOT_APPLICABLE';

export interface InspectionItem {
  id: string;
  label: string;
  description: string | null;
  condition: InspectionItemCondition | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionSummary {
  id: string;
  title: string;
  notes: string | null;
  status: InspectionStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  createdBy: WorkOrderMembershipSummary;
  completedBy: WorkOrderMembershipSummary | null;
}

export interface InspectionDetail {
  id: string;
  title: string;
  notes: string | null;
  status: InspectionStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workOrder: {
    id: string;
    number: number;
    title: string;
  };
  createdBy: WorkOrderMembershipSummary;
  completedBy: WorkOrderMembershipSummary | null;
  items: InspectionItem[];
}

export interface ListInspectionsParams {
  status?: InspectionStatus;
  page?: number;
  limit?: number;
}

export interface CreateInspectionInput {
  title: string;
  notes?: string | null;
  items?: Array<{ label: string; description?: string | null }>;
}

export interface UpdateInspectionInput {
  title?: string;
  notes?: string | null;
}

export interface AddInspectionItemInput {
  label: string;
  description?: string | null;
}

export interface UpdateInspectionItemInput {
  label?: string;
  description?: string | null;
  condition?: InspectionItemCondition | null;
  notes?: string | null;
}

function toQuery(params: ListInspectionsParams): string {
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
  return query.length > 0 ? `?${query}` : '';
}

function buildCreateInspectionBody(
  input: CreateInspectionInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title.trim(),
  };

  if (input.notes !== undefined) {
    body.notes =
      input.notes === null ? null : input.notes.trim() === '' ? null : input.notes.trim();
  }

  if (input.items !== undefined && input.items.length > 0) {
    body.items = input.items.map((item) => ({
      label: item.label.trim(),
      ...(item.description !== undefined
        ? {
            description:
              item.description === null || item.description.trim() === ''
                ? null
                : item.description.trim(),
          }
        : {}),
    }));
  }

  return body;
}

function buildUpdateInspectionBody(
  input: UpdateInspectionInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) {
    body.title = input.title.trim();
  }
  if (input.notes !== undefined) {
    body.notes =
      input.notes === null ? null : input.notes.trim() === '' ? null : input.notes.trim();
  }
  return body;
}

function buildUpdateInspectionItemBody(
  input: UpdateInspectionItemInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.label !== undefined) {
    body.label = input.label.trim();
  }
  if (input.description !== undefined) {
    body.description =
      input.description === null || input.description.trim() === ''
        ? null
        : input.description.trim();
  }
  if (input.condition !== undefined) {
    body.condition = input.condition;
  }
  if (input.notes !== undefined) {
    body.notes =
      input.notes === null || input.notes.trim() === ''
        ? null
        : input.notes.trim();
  }
  return body;
}

export async function listInspectionsRequest(
  workOrderId: string,
  params: ListInspectionsParams = {},
): Promise<PaginatedResponse<InspectionSummary>> {
  return apiRequest<PaginatedResponse<InspectionSummary>>(
    `/api/work-orders/${workOrderId}/inspections${toQuery(params)}`,
    { method: 'GET' },
  );
}

export async function getInspectionRequest(
  inspectionId: string,
): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(`/api/inspections/${inspectionId}`, {
    method: 'GET',
  });
}

export async function createInspectionRequest(
  workOrderId: string,
  input: CreateInspectionInput,
): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(
    `/api/work-orders/${workOrderId}/inspections`,
    {
      method: 'POST',
      body: buildCreateInspectionBody(input),
    },
  );
}

export async function updateInspectionRequest(
  inspectionId: string,
  input: UpdateInspectionInput,
): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(`/api/inspections/${inspectionId}`, {
    method: 'PATCH',
    body: buildUpdateInspectionBody(input),
  });
}

export async function addInspectionItemRequest(
  inspectionId: string,
  input: AddInspectionItemInput,
): Promise<InspectionItem> {
  return apiRequest<InspectionItem>(`/api/inspections/${inspectionId}/items`, {
    method: 'POST',
    body: {
      label: input.label.trim(),
      ...(input.description !== undefined
        ? {
            description:
              input.description === null || input.description.trim() === ''
                ? null
                : input.description.trim(),
          }
        : {}),
    },
  });
}

export async function updateInspectionItemRequest(
  inspectionId: string,
  itemId: string,
  input: UpdateInspectionItemInput,
): Promise<InspectionItem> {
  return apiRequest<InspectionItem>(
    `/api/inspections/${inspectionId}/items/${itemId}`,
    {
      method: 'PATCH',
      body: buildUpdateInspectionItemBody(input),
    },
  );
}

export async function deleteInspectionItemRequest(
  inspectionId: string,
  itemId: string,
): Promise<void> {
  await apiRequest<void>(
    `/api/inspections/${inspectionId}/items/${itemId}`,
    { method: 'DELETE' },
  );
}

export async function completeInspectionRequest(
  inspectionId: string,
): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(
    `/api/inspections/${inspectionId}/complete`,
    { method: 'POST' },
  );
}
