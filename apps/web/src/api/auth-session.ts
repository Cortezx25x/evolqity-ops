import { setAccessToken, setAuthBootstrapping } from './api-client';
import { meRequest, refreshRequest } from './auth.api';
import type { MeResponse } from './types';

let restoreSessionPromise: Promise<MeResponse | null> | null = null;

/** Single-flight: POST refresh (cookie) → in-memory token → GET /me */
export function restoreSession(): Promise<MeResponse | null> {
  if (restoreSessionPromise !== null) {
    return restoreSessionPromise;
  }

  restoreSessionPromise = (async () => {
    setAuthBootstrapping(true);
    try {
      const refreshed = await refreshRequest();
      setAccessToken(refreshed.accessToken);
      return await meRequest();
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      setAuthBootstrapping(false);
    }
  })();

  void restoreSessionPromise.finally(() => {
    restoreSessionPromise = null;
  });

  return restoreSessionPromise;
}
