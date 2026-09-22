import { ApiError, messageForApiError } from '../api/api-client';

export function messageForPlatformApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return messageForApiError(error);
  }

  if (error.status === 403) {
    return 'No tienes permisos para administrar organizaciones.';
  }

  if (error.status === 404) {
    return 'Organización no encontrada.';
  }

  if (error.status === 400) {
    return 'Revisa el nombre de la organización.';
  }

  if (error.status >= 500) {
    return 'No pudimos completar la solicitud. Intenta nuevamente.';
  }

  return messageForApiError(error);
}
