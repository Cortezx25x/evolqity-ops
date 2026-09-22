export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Thrown when a tenant-scoped request runs before organization bootstrap completes. */
export class TenantNotReadyError extends Error {
  constructor() {
    super('Tenant organization context is not ready');
    this.name = 'TenantNotReadyError';
  }
}

let accessToken: string | null = null;
let organizationIdProvider: (() => string | null) | null = null;
let authFailureHandler: (() => void) | null = null;
let refreshInFlight: Promise<import('./types').RefreshResponse | null> | null =
  null;
let authBootstrapping = false;

export function setAuthBootstrapping(value: boolean): void {
  authBootstrapping = value;
}

export function isAuthBootstrapping(): boolean {
  return authBootstrapping;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setOrganizationIdProvider(
  provider: (() => string | null) | null,
): void {
  organizationIdProvider = provider;
}

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler;
}

export function messageForApiError(error: unknown): string {
  if (error instanceof TenantNotReadyError) {
    return 'No pudimos cargar la organización seleccionada.';
  }

  if (error instanceof ApiError) {
    if (error.status === 400) {
      const normalized = error.message.toLowerCase();
      if (
        normalized.includes('organization context') ||
        normalized.includes('invalid organization context')
      ) {
        return 'No pudimos cargar la organización seleccionada.';
      }
    }
    if (error.status === 403) {
      return 'No tienes permisos para realizar esta acción.';
    }
    if (error.status === 404) {
      return 'No encontramos el recurso solicitado.';
    }
    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  if (error instanceof TypeError) {
    return 'No pudimos completar la solicitud. Intenta nuevamente.';
  }

  return 'No pudimos completar la solicitud. Intenta nuevamente.';
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof (body as { message: unknown }).message === 'string'
    ) {
      return (body as { message: string }).message;
    }
  } catch {
    // ignore parse errors
  }

  return response.statusText || 'Request failed';
}

async function performRefresh(): Promise<import('./types').RefreshResponse | null> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    setAccessToken(null);
    if (!authBootstrapping) {
      authFailureHandler?.();
    }
    return null;
  }

  const data = (await response.json()) as {
    accessToken?: string;
    expiresIn?: number;
  };
  if (typeof data.accessToken !== 'string') {
    setAccessToken(null);
    if (!authBootstrapping) {
      authFailureHandler?.();
    }
    return null;
  }

  setAccessToken(data.accessToken);
  return {
    accessToken: data.accessToken,
    expiresIn:
      typeof data.expiresIn === 'number' ? data.expiresIn : 900,
  };
}

async function refreshOnce(): Promise<import('./types').RefreshResponse | null> {
  if (refreshInFlight !== null) {
    return refreshInFlight;
  }

  refreshInFlight = performRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip Authorization header */
  auth?: false;
  /** Skip X-Organization-Id header */
  tenant?: false;
  /** Internal: prevent infinite retry */
  _retried?: boolean;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { body, auth, tenant, _retried, headers: initHeaders, ...rest } =
    options;

  const headers = new Headers(initHeaders);
  headers.set('Accept', 'application/json');

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (auth !== false && accessToken !== null) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const requiresTenantHeader =
    tenant !== false && auth !== false && accessToken !== null;

  if (requiresTenantHeader) {
    if (organizationIdProvider === null) {
      throw new TenantNotReadyError();
    }

    const organizationId = organizationIdProvider();
    if (organizationId === null || organizationId === '') {
      throw new TenantNotReadyError();
    }

    headers.set('X-Organization-Id', organizationId);
  } else if (tenant !== false && organizationIdProvider !== null) {
    const organizationId = organizationIdProvider();
    if (organizationId !== null) {
      headers.set('X-Organization-Id', organizationId);
    }
  }

  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (
    response.status === 401 &&
    auth !== false &&
    _retried !== true &&
    path !== '/api/auth/refresh' &&
    path !== '/api/auth/login'
  ) {
    const refreshed = await refreshOnce();
    if (refreshed !== null) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
    throw new ApiError(401, 'Unauthorized');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

export function dedupedRefresh(): Promise<import('./types').RefreshResponse | null> {
  return refreshOnce();
}

function buildAuthorizedHeaders(
  options: Pick<ApiRequestOptions, 'auth' | 'tenant'> & {
    accept?: string;
    contentType?: string | false;
  },
): Headers {
  const headers = new Headers();
  headers.set('Accept', options.accept ?? 'application/json');

  if (options.contentType !== false && options.contentType !== undefined) {
    headers.set('Content-Type', options.contentType);
  }

  if (options.auth !== false && accessToken !== null) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const requiresTenantHeader =
    options.tenant !== false && options.auth !== false && accessToken !== null;

  if (requiresTenantHeader) {
    if (organizationIdProvider === null) {
      throw new TenantNotReadyError();
    }

    const organizationId = organizationIdProvider();
    if (organizationId === null || organizationId === '') {
      throw new TenantNotReadyError();
    }

    headers.set('X-Organization-Id', organizationId);
  } else if (options.tenant !== false && organizationIdProvider !== null) {
    const organizationId = organizationIdProvider();
    if (organizationId !== null) {
      headers.set('X-Organization-Id', organizationId);
    }
  }

  return headers;
}

async function authorizedFetch(
  path: string,
  options: ApiRequestOptions & { accept?: string; contentType?: string | false },
): Promise<Response> {
  const {
    body,
    auth,
    tenant,
    _retried,
    headers: initHeaders,
    accept,
    contentType,
    ...rest
  } = options;

  const headers = buildAuthorizedHeaders({ auth, tenant, accept, contentType });
  for (const [key, value] of new Headers(initHeaders ?? {}).entries()) {
    headers.set(key, value);
  }

  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });

  if (
    response.status === 401 &&
    auth !== false &&
    _retried !== true &&
    path !== '/api/auth/refresh' &&
    path !== '/api/auth/login'
  ) {
    const refreshed = await refreshOnce();
    if (refreshed !== null) {
      return authorizedFetch(path, { ...options, _retried: true });
    }
    throw new ApiError(401, 'Unauthorized');
  }

  return response;
}

export async function apiFetchBlob(
  path: string,
  options: Omit<ApiRequestOptions, 'body'> = {},
): Promise<Blob> {
  const response = await authorizedFetch(path, {
    ...options,
    accept: '*/*',
    contentType: false,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new ApiError(response.status, message);
  }

  return response.blob();
}

export async function apiUploadMultipart<T>(
  path: string,
  file: File,
  caption?: string | null,
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  if (caption !== undefined && caption !== null && caption.trim() !== '') {
    formData.append('caption', caption.trim());
  }

  const response = await authorizedFetch(path, {
    method: 'POST',
    body: formData,
    contentType: false,
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}
