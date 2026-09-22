import type { OrganizationRole } from '../api/types';
import { hasOrganizationRole, ORGANIZATION_TEAM_ROLES } from './roles';

export interface AppNavItem {
  to: string;
  label: string;
  roles: readonly OrganizationRole[];
}

/** Central authenticated app navigation; filter with {@link filterAppNavigation}. */
export const APP_NAVIGATION: readonly AppNavItem[] = [
  {
    to: '/app/dashboard',
    label: 'Dashboard',
    roles: ['OWNER', 'ADMIN', 'MEMBER'],
  },
  {
    to: '/app/customers',
    label: 'Clientes',
    roles: ['OWNER', 'ADMIN', 'MEMBER'],
  },
  {
    to: '/app/assets',
    label: 'Activos',
    roles: ['OWNER', 'ADMIN', 'MEMBER'],
  },
  {
    to: '/app/work-orders',
    label: 'Órdenes de trabajo',
    roles: ['OWNER', 'ADMIN', 'MEMBER'],
  },
  {
    to: '/app/team',
    label: 'Equipo',
    roles: ORGANIZATION_TEAM_ROLES,
  },
] as const;

export function filterAppNavigation(role: OrganizationRole): AppNavItem[] {
  return APP_NAVIGATION.filter((item) => hasOrganizationRole(role, item.roles));
}

export function isAppPathAllowedForRole(
  pathname: string,
  role: OrganizationRole,
): boolean {
  const normalized = pathname.split('?')[0]?.replace(/\/+$/, '') ?? pathname;

  if (normalized === '/app/team' || normalized.startsWith('/app/team/')) {
    return hasOrganizationRole(role, ORGANIZATION_TEAM_ROLES);
  }

  const match = APP_NAVIGATION.find(
    (item) =>
      normalized === item.to || normalized.startsWith(`${item.to}/`),
  );

  if (match === undefined) {
    return true;
  }

  return hasOrganizationRole(role, match.roles);
}
