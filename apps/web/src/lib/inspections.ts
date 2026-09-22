import { ApiError, messageForApiError } from '../api/api-client';
import type {
  InspectionItemCondition,
  InspectionStatus,
} from '../api/inspections.api';

export function inspectionStatusLabel(status: InspectionStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Borrador';
    case 'COMPLETED':
      return 'Completada';
    default:
      return status;
  }
}

export function inspectionConditionLabel(
  condition: InspectionItemCondition,
): string {
  switch (condition) {
    case 'OK':
      return 'Bien';
    case 'ATTENTION':
      return 'Atención';
    case 'FAIL':
      return 'Falla';
    case 'NOT_APPLICABLE':
      return 'No aplica';
    default:
      return condition;
  }
}

export const INSPECTION_CONDITIONS: InspectionItemCondition[] = [
  'OK',
  'ATTENTION',
  'FAIL',
  'NOT_APPLICABLE',
];

export function messageForInspectionApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return messageForApiError(error);
  }

  const normalized = error.message.toLowerCase();

  if (error.status === 400) {
    return 'Los datos de la inspección no son válidos.';
  }

  if (error.status === 403) {
    return 'No tienes permisos para realizar esta acción.';
  }

  if (error.status === 404) {
    if (normalized.includes('inspection')) {
      return 'Inspección no encontrada.';
    }
    return 'No encontramos el recurso solicitado.';
  }

  if (error.status === 409) {
    if (normalized.includes('media')) {
      return 'No puedes eliminar este punto porque tiene fotografías asociadas.';
    }
    if (normalized.includes('closed')) {
      return 'Esta orden está cerrada y ya no puede modificarse.';
    }
    if (normalized.includes('completed')) {
      return 'Esta inspección ya está completada.';
    }
    if (
      normalized.includes('incomplete') ||
      normalized.includes('no items')
    ) {
      return 'Completa todos los puntos antes de finalizar la inspección.';
    }
  }

  if (error.status >= 500) {
    return 'No pudimos completar la solicitud. Intenta nuevamente.';
  }

  return messageForApiError(error);
}

export function inspectionHasIncompleteItems(
  items: Array<{ condition: InspectionItemCondition | null }>,
): boolean {
  return items.length === 0 || items.some((item) => item.condition === null);
}
