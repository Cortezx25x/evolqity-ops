import { apiRequest } from './api-client';
import type {
  Customer,
  CustomerType,
  PaginatedResponse,
} from './types';

export interface ListCustomersParams {
  search?: string;
  active?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateCustomerInput {
  type?: CustomerType;
  name: string;
  identification?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

/** Matches backend `createCustomerBodySchema`: optional keys must be strings or omitted, never null. */
function buildCreateCustomerBody(
  input: CreateCustomerInput,
): Record<string, string> {
  const body: Record<string, string> = {
    name: input.name.trim(),
  };

  if (input.type !== undefined) {
    body.type = input.type;
  }

  const optionalFields = [
    ['identification', input.identification],
    ['email', input.email],
    ['phone', input.phone],
    ['notes', input.notes],
  ] as const;

  for (const [key, value] of optionalFields) {
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      body[key] = trimmed;
    }
  }

  return body;
}

function toQuery(params: ListCustomersParams): string {
  const search = new URLSearchParams();
  if (params.search !== undefined && params.search !== '') {
    search.set('search', params.search);
  }
  if (params.active === false) {
    search.set('active', 'false');
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

export async function listCustomersRequest(
  params: ListCustomersParams = {},
): Promise<PaginatedResponse<Customer>> {
  return apiRequest<PaginatedResponse<Customer>>(
    `/api/customers${toQuery(params)}`,
    { method: 'GET' },
  );
}

export async function createCustomerRequest(
  input: CreateCustomerInput,
): Promise<Customer> {
  return apiRequest<Customer>('/api/customers', {
    method: 'POST',
    body: buildCreateCustomerBody(input),
  });
}

export async function getCustomerRequest(id: string): Promise<Customer> {
  return apiRequest<Customer>(`/api/customers/${id}`, { method: 'GET' });
}
