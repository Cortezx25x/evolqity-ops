import { ApiError, messageForApiError } from '../api/api-client';
import type {
  EstimateItemType,
  EstimateStatus,
} from '../api/estimates.api';

const QUANTITY_INPUT_PATTERN =
  /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;
const MONEY_INPUT_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const PERCENT_INPUT_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;

export function estimateStatusLabel(status: EstimateStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Borrador';
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

export function estimateItemTypeLabel(type: EstimateItemType): string {
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

export const ESTIMATE_ITEM_TYPES: EstimateItemType[] = [
  'LABOR',
  'PART',
  'SERVICE',
  'OTHER',
];

export function estimateStatusBadgeClass(status: EstimateStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'status-badge--muted';
    case 'SENT':
      return 'status-badge--info';
    case 'APPROVED':
      return 'status-badge--success';
    case 'REJECTED':
      return 'status-badge--danger';
    case 'CANCELLED':
      return 'status-badge--warning';
    default:
      return 'status-badge--muted';
  }
}

export function isEstimateDraft(status: EstimateStatus): boolean {
  return status === 'DRAFT';
}

export function isEstimateTerminal(status: EstimateStatus): boolean {
  return (
    status === 'APPROVED' ||
    status === 'REJECTED' ||
    status === 'CANCELLED'
  );
}

export function toDateInputValue(iso: string | null): string {
  if (iso === null) {
    return '';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const date = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function parseDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateEstimateItemFields(input: {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
}): string | null {
  if (input.description.trim().length === 0) {
    return 'La descripción es obligatoria.';
  }

  if (!QUANTITY_INPUT_PATTERN.test(input.quantity.trim())) {
    return 'La cantidad debe ser un número positivo con hasta 3 decimales.';
  }
  const quantityValue = parseDecimal(input.quantity);
  if (quantityValue === null || quantityValue <= 0) {
    return 'La cantidad debe ser mayor que cero.';
  }

  if (!MONEY_INPUT_PATTERN.test(input.unitPrice.trim())) {
    return 'El precio unitario debe tener hasta 2 decimales.';
  }
  const unitPriceValue = parseDecimal(input.unitPrice);
  if (unitPriceValue === null || unitPriceValue < 0) {
    return 'El precio unitario no puede ser negativo.';
  }

  if (!PERCENT_INPUT_PATTERN.test(input.discountPercent.trim())) {
    return 'El descuento debe ser un porcentaje válido.';
  }
  const discountValue = parseDecimal(input.discountPercent);
  if (
    discountValue === null ||
    discountValue < 0 ||
    discountValue > 100
  ) {
    return 'El descuento debe estar entre 0 y 100.';
  }

  if (!PERCENT_INPUT_PATTERN.test(input.taxPercent.trim())) {
    return 'El impuesto debe ser un porcentaje válido.';
  }
  const taxValue = parseDecimal(input.taxPercent);
  if (taxValue === null || taxValue < 0 || taxValue > 100) {
    return 'El impuesto debe estar entre 0 y 100.';
  }

  return null;
}

export function validateCurrencyCode(currency: string): string | null {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    return 'La moneda debe ser un código de 3 letras (por ejemplo CRC).';
  }
  return null;
}

export function messageForEstimateApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return messageForApiError(error);
  }

  const normalized = error.message.toLowerCase();

  if (error.status === 400) {
    if (normalized.includes('monetary') || normalized.includes('invalid')) {
      return 'Revisa los datos de la cotización.';
    }
    return 'Revisa los datos de la cotización.';
  }

  if (error.status === 403) {
    return 'No tienes permisos para realizar esta acción.';
  }

  if (error.status === 404) {
    if (normalized.includes('estimate')) {
      return 'Cotización no encontrada.';
    }
    return 'Cotización no encontrada.';
  }

  if (error.status === 409) {
    if (normalized.includes('locked')) {
      return 'Esta cotización ya no puede modificarse.';
    }
    if (normalized.includes('closed')) {
      return 'Esta orden está cerrada y ya no puede modificarse.';
    }
    if (normalized.includes('no items')) {
      return 'Agrega al menos un concepto antes de enviar la cotización.';
    }
    if (normalized.includes('transition')) {
      return 'No se puede realizar ese cambio de estado.';
    }
  }

  if (error.status >= 500) {
    return 'No pudimos completar la solicitud. Intenta nuevamente.';
  }

  return messageForApiError(error);
}

export function messageForEstimatePublicAccessError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return messageForApiError(error);
  }

  const normalized = error.message.toLowerCase();

  if (error.status === 403) {
    return 'No tienes permisos para administrar el enlace de esta cotización.';
  }

  if (error.status === 404) {
    return 'Cotización no encontrada.';
  }

  if (error.status === 409) {
    if (normalized.includes('closed')) {
      return 'Esta orden está cerrada y ya no puede modificarse.';
    }
    return 'No se puede generar un enlace para esta cotización en su estado actual.';
  }

  if (error.status >= 500) {
    return 'No pudimos administrar el enlace. Intenta nuevamente.';
  }

  return messageForApiError(error);
}

export function estimateTerminalTimestampLabel(
  status: EstimateStatus,
  detail: {
    sentAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    cancelledAt: string | null;
  },
): string | null {
  switch (status) {
    case 'SENT':
      return detail.sentAt;
    case 'APPROVED':
      return detail.approvedAt;
    case 'REJECTED':
      return detail.rejectedAt;
    case 'CANCELLED':
      return detail.cancelledAt;
    default:
      return null;
  }
}
