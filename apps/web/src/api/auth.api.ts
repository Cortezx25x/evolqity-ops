import { ApiError, apiRequest, dedupedRefresh } from './api-client';
import type { LoginResponse, MeResponse, RefreshResponse } from './types';

export async function loginRequest(
  email: string,
  password: string,
): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    auth: false,
    tenant: false,
    body: { email, password },
  });
}

export async function refreshRequest(): Promise<RefreshResponse> {
  const result = await dedupedRefresh();
  if (result === null) {
    throw new ApiError(401, 'Invalid refresh token');
  }
  return result;
}

export async function logoutRequest(): Promise<void> {
  await apiRequest<void>('/api/auth/logout', {
    method: 'POST',
    auth: false,
    tenant: false,
  });
}

export async function meRequest(): Promise<MeResponse> {
  return apiRequest<MeResponse>('/api/auth/me', { method: 'GET', tenant: false });
}
