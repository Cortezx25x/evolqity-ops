import type {
  PublicEstimateDecisionBody,
  PublicEstimateView,
} from './public-estimate.types';
import { PublicEstimateApiError } from './public-estimate.types';
import { customerMessages } from '../lib/public-messages';

const API_PREFIX = '/api/public/estimates';

function buildAuthHeader(token: string): HeadersInit {
  return {
    Authorization: `Estimate ${token}`,
    Accept: 'application/json',
  };
}

function mapStatusToError(status: number): PublicEstimateApiError {
  switch (status) {
    case 404:
      return new PublicEstimateApiError(
        'not_found',
        'Este enlace no es válido o ya no está disponible.',
        404,
      );
    case 410:
      return new PublicEstimateApiError(
        'expired',
        'Este enlace ha vencido.',
        410,
      );
    case 409:
      return new PublicEstimateApiError(
        'conflict',
        'No se pudo registrar tu respuesta. El estado de la cotización ha cambiado.',
        409,
      );
    case 429:
      return new PublicEstimateApiError(
        'rate_limit',
        'Se realizaron demasiados intentos. Intenta nuevamente más tarde.',
        429,
      );
    case 400:
      return new PublicEstimateApiError(
        'validation',
        'Revisa los datos ingresados e intenta de nuevo.',
        400,
      );
    default:
      if (status >= 500) {
        return new PublicEstimateApiError(
          'server',
          'Ocurrió un error. Intenta nuevamente más tarde.',
          status,
        );
      }

      return new PublicEstimateApiError(
        'server',
        'Ocurrió un error. Intenta nuevamente más tarde.',
        status,
      );
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) {
    throw new PublicEstimateApiError(
      'server',
      'Ocurrió un error. Intenta nuevamente más tarde.',
      response.status,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PublicEstimateApiError(
      'server',
      'Ocurrió un error. Intenta nuevamente más tarde.',
      response.status,
    );
  }
}

export async function fetchPublicEstimateView(
  token: string,
): Promise<PublicEstimateView> {
  let response: Response;

  try {
    response = await fetch(`${API_PREFIX}/view`, {
      method: 'GET',
      headers: buildAuthHeader(token),
      cache: 'no-store',
    });
  } catch {
    throw new PublicEstimateApiError(
      'network',
      'No pudimos conectar. Revisa tu conexión e intenta de nuevo.',
      null,
    );
  }

  if (!response.ok) {
    throw mapStatusToError(response.status);
  }

  return parseJsonResponse<PublicEstimateView>(response);
}

export async function submitPublicEstimateDecision(
  token: string,
  body: PublicEstimateDecisionBody,
): Promise<PublicEstimateView> {
  let response: Response;

  const payload: PublicEstimateDecisionBody =
    body.decision === 'APPROVED'
      ? { decision: 'APPROVED', responderName: body.responderName.trim() }
      : {
          decision: 'REJECTED',
          responderName: body.responderName.trim(),
          ...(body.rejectionReason !== undefined &&
          body.rejectionReason.trim().length > 0
            ? { rejectionReason: body.rejectionReason.trim() }
            : {}),
        };

  try {
    response = await fetch(`${API_PREFIX}/decision`, {
      method: 'POST',
      headers: {
        ...buildAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    throw new PublicEstimateApiError(
      'network',
      'No pudimos conectar. Revisa tu conexión e intenta de nuevo.',
      null,
    );
  }

  if (!response.ok) {
    throw mapStatusToError(response.status);
  }

  return parseJsonResponse<PublicEstimateView>(response);
}

export function messageForApiError(error: unknown): string {
  if (error instanceof PublicEstimateApiError) {
    return error.message;
  }

  return customerMessages.server;
}
