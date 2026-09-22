import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { setOrganizationIdProvider } from '../api/api-client';
import type { OrganizationSummary } from '../api/types';
import { SELECTED_ORGANIZATION_STORAGE_KEY } from '../lib/storage-keys';
import { useAuth } from './AuthContext';

export type OrganizationPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'select';

interface OrganizationContextValue {
  phase: OrganizationPhase;
  organizations: OrganizationSummary[];
  selectedOrganization: OrganizationSummary | null;
  /** Auth done and a validated organization is selected for tenant API calls */
  isTenantReady: boolean;
  selectOrganization: (organizationId: string) => void;
  error: string | null;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null,
);

function readStoredOrganizationId(): string | null {
  try {
    const value = localStorage.getItem(SELECTED_ORGANIZATION_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStoredOrganizationId(organizationId: string | null): void {
  try {
    if (organizationId === null) {
      localStorage.removeItem(SELECTED_ORGANIZATION_STORAGE_KEY);
    } else {
      localStorage.setItem(SELECTED_ORGANIZATION_STORAGE_KEY, organizationId);
    }
  } catch {
    // ignore storage failures
  }
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { status, organizations: authOrganizations } = useAuth();
  const [phase, setPhase] = useState<OrganizationPhase>('idle');
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>(
    [],
  );
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const selectedOrganization = useMemo(
    () =>
      organizations.find((org) => org.id === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId],
  );

  const selectOrganization = useCallback((organizationId: string) => {
    setSelectedOrganizationId(organizationId);
    writeStoredOrganizationId(organizationId);
    setPhase('ready');
    setError(null);
  }, []);

  const applyOrganizations = useCallback((list: OrganizationSummary[]) => {
    setOrganizations(list);

    if (list.length === 0) {
      setSelectedOrganizationId(null);
      writeStoredOrganizationId(null);
      setPhase('empty');
      return;
    }

    const storedId = readStoredOrganizationId();
    const storedMatch =
      storedId !== null ? list.find((org) => org.id === storedId) : undefined;

    if (storedMatch !== undefined) {
      setSelectedOrganizationId(storedMatch.id);
      writeStoredOrganizationId(storedMatch.id);
      setPhase('ready');
      return;
    }

    if (list.length === 1) {
      setSelectedOrganizationId(list[0].id);
      writeStoredOrganizationId(list[0].id);
      setPhase('ready');
      return;
    }

    setSelectedOrganizationId(null);
    setPhase('select');
  }, []);

  useEffect(() => {
    if (status === 'loading') {
      setPhase('idle');
      return;
    }

    if (status === 'unauthenticated') {
      setOrganizations([]);
      setSelectedOrganizationId(null);
      writeStoredOrganizationId(null);
      setPhase('idle');
      setError(null);
      return;
    }

    setPhase('loading');
    applyOrganizations(authOrganizations);
  }, [status, authOrganizations, applyOrganizations]);

  const isTenantReady =
    status === 'authenticated' &&
    phase === 'ready' &&
    selectedOrganization !== null;

  useLayoutEffect(() => {
    if (isTenantReady && selectedOrganizationId !== null) {
      const organizationId = selectedOrganizationId;
      setOrganizationIdProvider(() => organizationId);
      return () => {
        setOrganizationIdProvider(null);
      };
    }

    setOrganizationIdProvider(null);
    return () => {
      setOrganizationIdProvider(null);
    };
  }, [isTenantReady, selectedOrganizationId]);

  const value = useMemo<OrganizationContextValue>(
    () => ({
      phase,
      organizations,
      selectedOrganization,
      isTenantReady,
      selectOrganization,
      error,
    }),
    [
      phase,
      organizations,
      selectedOrganization,
      isTenantReady,
      selectOrganization,
      error,
    ],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (context === null) {
    throw new Error('useOrganization must be used within OrganizationProvider');
  }
  return context;
}
