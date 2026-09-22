import type { OrganizationRole } from '../api/types';

export function organizationRoleLabel(role: OrganizationRole): string {
  switch (role) {
    case 'OWNER':
      return 'Propietario';
    case 'ADMIN':
      return 'Administrador';
    case 'MEMBER':
      return 'Miembro';
    default:
      return role;
  }
}

export function canManageOrganization(role: OrganizationRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function hasOrganizationRole(
  role: OrganizationRole,
  allowedRoles: readonly OrganizationRole[],
): boolean {
  return allowedRoles.includes(role);
}

export const ORGANIZATION_TEAM_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly OrganizationRole[];

export function canAccessTeamArea(role: OrganizationRole): boolean {
  return hasOrganizationRole(role, ORGANIZATION_TEAM_ROLES);
}

export function canManageMemberLifecycle(
  actorRole: OrganizationRole,
  actorMembershipId: string | undefined,
  target: { id: string; role: OrganizationRole; active: boolean },
): { canDeactivate: boolean; canReactivate: boolean } {
  if (!canManageOrganization(actorRole)) {
    return { canDeactivate: false, canReactivate: false };
  }

  if (
    actorMembershipId !== undefined &&
    target.id === actorMembershipId
  ) {
    return { canDeactivate: false, canReactivate: false };
  }

  if (target.role === 'OWNER') {
    return { canDeactivate: false, canReactivate: false };
  }

  if (actorRole === 'ADMIN' && target.role !== 'MEMBER') {
    return { canDeactivate: false, canReactivate: false };
  }

  return {
    canDeactivate: target.active,
    canReactivate: !target.active,
  };
}
