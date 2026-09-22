import type {
  CustomerType,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../api/types';

export function customerTypeLabel(type: CustomerType): string {
  switch (type) {
    case 'PERSON':
      return 'Persona';
    case 'COMPANY':
      return 'Empresa';
    default:
      return type;
  }
}

export function workOrderStatusLabel(status: WorkOrderStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Borrador';
    case 'OPEN':
      return 'Abierta';
    case 'IN_PROGRESS':
      return 'En progreso';
    case 'WAITING':
      return 'En espera';
    case 'COMPLETED':
      return 'Completada';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return status;
  }
}

export function workOrderPriorityLabel(priority: WorkOrderPriority): string {
  switch (priority) {
    case 'LOW':
      return 'Baja';
    case 'NORMAL':
      return 'Normal';
    case 'HIGH':
      return 'Alta';
    case 'URGENT':
      return 'Urgente';
    default:
      return priority;
  }
}
