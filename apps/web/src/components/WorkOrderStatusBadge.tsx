import type { WorkOrderPriority, WorkOrderStatus } from '../api/types';
import {
  workOrderPriorityLabel,
  workOrderStatusLabel,
} from '../lib/labels';

const statusClass: Record<WorkOrderStatus, string> = {
  DRAFT: 'status-badge--muted',
  OPEN: 'status-badge--info',
  IN_PROGRESS: 'status-badge--progress',
  WAITING: 'status-badge--warning',
  COMPLETED: 'status-badge--success',
  CANCELLED: 'status-badge--danger',
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return (
    <span className={`status-badge ${statusClass[status]}`}>
      {workOrderStatusLabel(status)}
    </span>
  );
}

export function WorkOrderPriorityBadge({
  priority,
}: {
  priority: WorkOrderPriority;
}) {
  return (
    <span className="priority-badge">{workOrderPriorityLabel(priority)}</span>
  );
}
