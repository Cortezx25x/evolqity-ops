import type {
  PublicEstimateBlockedReason,
  PublicEstimateStatus,
  PublicEstimateView,
} from '../api/public-estimate.types';

export const customerMessages = {
  missingToken: 'No encontramos una cotización para mostrar.',
  notFound: 'Este enlace no es válido o ya no está disponible.',
  expired: 'Este enlace ha vencido.',
  rateLimit: 'Se realizaron demasiados intentos. Intenta nuevamente más tarde.',
  conflict:
    'No se pudo registrar tu respuesta. El estado de la cotización ha cambiado.',
  network: 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.',
  server: 'Ocurrió un error. Intenta nuevamente más tarde.',
  loadError: 'No pudimos cargar la cotización.',
} as const;

export function statusHeadline(view: PublicEstimateView): string | null {
  const { status, canRespond, blockedReason } = view.estimate;

  if (status === 'APPROVED') {
    return 'Esta cotización fue aprobada.';
  }

  if (status === 'REJECTED') {
    return 'Esta cotización fue rechazada.';
  }

  if (status === 'CANCELLED') {
    return 'Esta cotización fue cancelada.';
  }

  if (status === 'SENT' && canRespond) {
    return null;
  }

  if (blockedReason === 'ESTIMATE_EXPIRED') {
    return 'Esta cotización ya no acepta respuestas.';
  }

  if (blockedReason === 'WORK_ORDER_CLOSED') {
    return 'Esta cotización ya no acepta respuestas.';
  }

  if (status === 'SENT' && !canRespond) {
    return 'Esta cotización ya no acepta respuestas.';
  }

  return null;
}

export function blockedReasonLabel(
  reason: PublicEstimateBlockedReason,
): string | null {
  if (reason === 'ESTIMATE_EXPIRED' || reason === 'WORK_ORDER_CLOSED') {
    return 'Esta cotización ya no acepta respuestas.';
  }

  return null;
}

export function estimateStatusLabel(status: PublicEstimateStatus): string {
  switch (status) {
    case 'SENT':
      return 'Enviada';
    case 'APPROVED':
      return 'Aprobada';
    case 'REJECTED':
      return 'Rechazada';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return status;
  }
}

export function itemTypeLabel(type: string): string {
  switch (type) {
    case 'LABOR':
      return 'Mano de obra';
    case 'PART':
      return 'Repuesto';
    case 'SERVICE':
      return 'Servicio';
    case 'OTHER':
      return 'Otro';
    default:
      return type;
  }
}
