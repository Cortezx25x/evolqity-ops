import { apiRequest } from './api-client';
import type { OrganizationSummary } from './types';

export async function listOrganizationsRequest(): Promise<
  OrganizationSummary[]
> {
  return apiRequest<OrganizationSummary[]>('/api/organizations', {
    method: 'GET',
    tenant: false,
  });
}
