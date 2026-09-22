import { apiRequest } from './api-client';
import type { Asset, AssetType, PaginatedResponse } from './types';

export interface ListAssetsParams {
  search?: string;
  customerId?: string;
  type?: AssetType;
  active?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateAssetInput {
  customerId: string;
  type?: AssetType;
  name: string;
  identifier?: string;
  plate?: string;
  vin?: string;
  serialNumber?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  notes?: string;
}

export interface UpdateAssetInput {
  customerId?: string;
  type?: AssetType;
  name?: string;
  identifier?: string;
  plate?: string;
  vin?: string;
  serialNumber?: string;
  make?: string;
  model?: string;
  year?: number | null;
  color?: string;
  notes?: string;
}

function toQuery(params: ListAssetsParams): string {
  const search = new URLSearchParams();
  if (params.search !== undefined && params.search !== '') {
    search.set('search', params.search);
  }
  if (params.customerId !== undefined) {
    search.set('customerId', params.customerId);
  }
  if (params.type !== undefined) {
    search.set('type', params.type);
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

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildCreateAssetBody(input: CreateAssetInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    customerId: input.customerId,
    name: input.name.trim(),
  };

  if (input.type !== undefined) {
    body.type = input.type;
  }

  const optionalFields = [
    ['identifier', input.identifier],
    ['plate', input.plate],
    ['vin', input.vin],
    ['serialNumber', input.serialNumber],
    ['make', input.make],
    ['model', input.model],
    ['color', input.color],
    ['notes', input.notes],
  ] as const;

  for (const [key, value] of optionalFields) {
    const normalized = optionalString(value);
    if (normalized !== undefined) {
      body[key] = normalized;
    }
  }

  if (input.year !== undefined) {
    body.year = input.year;
  }

  return body;
}

function buildUpdateAssetBody(input: UpdateAssetInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (input.customerId !== undefined) {
    body.customerId = input.customerId;
  }
  if (input.type !== undefined) {
    body.type = input.type;
  }
  if (input.name !== undefined) {
    body.name = input.name.trim();
  }

  const nullableStrings = [
    ['identifier', input.identifier],
    ['plate', input.plate],
    ['vin', input.vin],
    ['serialNumber', input.serialNumber],
    ['make', input.make],
    ['model', input.model],
    ['color', input.color],
    ['notes', input.notes],
  ] as const;

  for (const [key, value] of nullableStrings) {
    if (value !== undefined) {
      body[key] = value === null ? null : value.trim() || null;
    }
  }

  if (input.year !== undefined) {
    body.year = input.year;
  }

  return body;
}

export async function listAssetsRequest(
  params: ListAssetsParams = {},
): Promise<PaginatedResponse<Asset>> {
  return apiRequest<PaginatedResponse<Asset>>(
    `/api/assets${toQuery(params)}`,
    { method: 'GET' },
  );
}

export async function getAssetRequest(id: string): Promise<Asset> {
  return apiRequest<Asset>(`/api/assets/${id}`, { method: 'GET' });
}

export async function createAssetRequest(input: CreateAssetInput): Promise<Asset> {
  return apiRequest<Asset>('/api/assets', {
    method: 'POST',
    body: buildCreateAssetBody(input),
  });
}

export async function updateAssetRequest(
  id: string,
  input: UpdateAssetInput,
): Promise<Asset> {
  return apiRequest<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: buildUpdateAssetBody(input),
  });
}

export async function activateAssetRequest(id: string): Promise<Asset> {
  return apiRequest<Asset>(`/api/assets/${id}/activate`, { method: 'POST' });
}

export async function deactivateAssetRequest(id: string): Promise<Asset> {
  return apiRequest<Asset>(`/api/assets/${id}/deactivate`, { method: 'POST' });
}
