import { useOrganization } from '../contexts/OrganizationContext';

/** True when auth and organization bootstrap finished and X-Organization-Id is valid. */
export function useTenantReady(): boolean {
  const { isTenantReady } = useOrganization();
  return isTenantReady;
}
