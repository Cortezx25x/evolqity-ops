import type { OrganizationRole, WorkOrderStatus } from '../api/types';

const allowedStatusTransitions: Record<
  WorkOrderStatus,
  ReadonlySet<WorkOrderStatus>
> = {
  DRAFT: new Set(['OPEN', 'CANCELLED']),
  OPEN: new Set(['IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED']),
  IN_PROGRESS: new Set(['WAITING', 'COMPLETED', 'CANCELLED']),
  WAITING: new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

const memberStatusTransitions = new Set([
  'OPEN:IN_PROGRESS',
  'OPEN:WAITING',
  'OPEN:COMPLETED',
  'IN_PROGRESS:WAITING',
  'IN_PROGRESS:COMPLETED',
  'WAITING:IN_PROGRESS',
  'WAITING:COMPLETED',
]);

export function isWorkOrderClosed(status: WorkOrderStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

export function getAllowedStatusTargets(
  currentStatus: WorkOrderStatus,
  role: OrganizationRole,
): WorkOrderStatus[] {
  const targets = allowedStatusTransitions[currentStatus];
  return [...targets].filter((target) => {
    if (role === 'MEMBER') {
      return memberStatusTransitions.has(`${currentStatus}:${target}`);
    }
    return true;
  });
}
