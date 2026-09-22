import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { restoreSession } from '../api/auth-session';
import { loginRequest, logoutRequest, meRequest } from '../api/auth.api';
import {
  setAccessToken,
  setAuthFailureHandler,
} from '../api/api-client';
import type { OrganizationSummary, PlatformRole, PublicAuthUser } from '../api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicAuthUser | null;
  organizations: OrganizationSummary[];
  platformRole: PlatformRole | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicAuthUser | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>(
    [],
  );
  const [platformRole, setPlatformRole] = useState<PlatformRole | null>(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setOrganizations([]);
    setPlatformRole(null);
    setStatus('unauthenticated');
  }, []);

  const applyMe = useCallback((me: Awaited<ReturnType<typeof meRequest>>) => {
    setUser(me.user);
    setOrganizations(me.organizations);
    setPlatformRole(me.platformRole);
    setStatus('authenticated');
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await meRequest();
    applyMe(me);
  }, [applyMe]);

  useEffect(() => {
    setAuthFailureHandler(() => {
      clearSession();
    });

    void restoreSession().then((me) => {
      if (me === null) {
        clearSession();
      } else {
        applyMe(me);
      }
    });

    return () => {
      setAuthFailureHandler(null);
    };
  }, [applyMe, clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await loginRequest(email, password);
      setAccessToken(session.accessToken);
      setUser(session.user);
      setOrganizations(session.organizations);
      setPlatformRole(session.platformRole);
      setStatus('authenticated');
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // best-effort logout
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      organizations,
      platformRole,
      login,
      logout,
      refreshProfile,
    }),
    [status, user, organizations, platformRole, login, logout, refreshProfile],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
