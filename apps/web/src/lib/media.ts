import { ApiError, messageForApiError, TenantNotReadyError } from '../api/api-client';

/** Matches default backend MEDIA_MAX_FILE_SIZE_BYTES (10 MiB). */
export const MEDIA_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp';

export const MEDIA_ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function validateMediaFileForUpload(file: File): string | null {
  if (!MEDIA_ACCEPTED_MIME_TYPES.has(file.type)) {
    return 'El formato de esta imagen no es compatible. Usa JPG, PNG o WEBP.';
  }
  if (file.size > MEDIA_MAX_FILE_SIZE_BYTES) {
    return 'La imagen supera el tamaño máximo permitido.';
  }
  return null;
}

export function messageForMediaApiError(error: unknown): string {
  if (error instanceof TenantNotReadyError) {
    return messageForApiError(error);
  }

  if (error instanceof ApiError) {
    const normalized = error.message.toLowerCase();

    if (error.status === 415 || normalized.includes('unsupported media')) {
      return 'El formato de esta imagen no es compatible. Usa JPG, PNG o WEBP.';
    }
    if (error.status === 413 || normalized.includes('too large')) {
      return 'La imagen supera el tamaño máximo permitido.';
    }
    if (normalized.includes('work order is closed')) {
      return 'Esta orden está cerrada y ya no puede modificarse.';
    }
    if (normalized.includes('inspection is completed')) {
      return 'Esta inspección está completada y ya no puede modificarse.';
    }
    if (error.status === 404) {
      return 'Fotografía no encontrada.';
    }
    if (error.status === 403) {
      return 'No tienes permisos para acceder a esta fotografía.';
    }
    if (error.status >= 500) {
      return 'No pudimos procesar la fotografía. Intenta nuevamente.';
    }
  }

  if (error instanceof TypeError) {
    return 'No pudimos procesar la fotografía. Intenta nuevamente.';
  }

  return messageForApiError(error);
}
