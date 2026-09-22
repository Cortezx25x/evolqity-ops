import { apiRequest } from './api-client';
import type { PaginatedResponse } from './types';

export interface PlatformOrganizationOwner {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  owner: PlatformOrganizationOwner | null;
  activeMemberCount: number;
}

export interface ListPlatformOrganizationsParams {
  search?: string;
  status?: 'active' | 'inactive';
  page?: number;
  limit?: number;
}

export async function listPlatformOrganizationsRequest(
  params: ListPlatformOrganizationsParams = {},
): Promise<PaginatedResponse<PlatformOrganizationSummary>> {
  const search = new URLSearchParams();
  if (params.search !== undefined && params.search.trim() !== '') {
    search.set('search', params.search.trim());
  }
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
  return apiRequest<PaginatedResponse<PlatformOrganizationSummary>>(
    `/api/platform/organizations${query ? `?${query}` : ''}`,
    { method: 'GET', tenant: false },
  );
}

export async function deactivatePlatformOrganizationRequest(
  organizationId: string,
): Promise<PlatformOrganizationSummary> {
  return apiRequest<PlatformOrganizationSummary>(
    `/api/platform/organizations/${organizationId}/deactivate`,
    { method: 'POST', tenant: false },
  );
}

export async function activatePlatformOrganizationRequest(
  organizationId: string,
): Promise<PlatformOrganizationSummary> {
  return apiRequest<PlatformOrganizationSummary>(
    `/api/platform/organizations/${organizationId}/activate`,
    { method: 'POST', tenant: false },
  );
}

export interface PlatformOrganizationDetail extends PlatformOrganizationSummary {
  slug: string;
  type: string | null;
  updatedAt: string;
  inactiveMemberCount: number;
}

export async function updatePlatformOrganizationRequest(
  organizationId: string,
  input: { name: string },
): Promise<PlatformOrganizationDetail> {
  return apiRequest<PlatformOrganizationDetail>(
    `/api/platform/organizations/${organizationId}`,
    {
      method: 'PATCH',
      tenant: false,
      body: input,
    },
  );
}
