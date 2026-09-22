import type { PublicAuthUser, WorkOrderUserSummary } from '../api/types';

export function formatUserDisplayName(
  user: PublicAuthUser | WorkOrderUserSummary,
): string {
  const parts = [user.firstName, user.lastName].filter(
    (part): part is string => part !== null && part.trim().length > 0,
  );

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return user.email;
}
