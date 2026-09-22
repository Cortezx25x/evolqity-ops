import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { OrganizationRole } from '../../api/types';
import { useAuth } from '../../contexts/AuthContext';
import { useOrganization } from '../../contexts/OrganizationContext';
import { isPlatformAdmin, resolveDefaultAuthenticatedPath } from '../../lib/platform';
import { hasOrganizationRole } from '../../lib/roles';
import { FullPageLoader } from '../FullPageLoader';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoader label="Restaurando sesión…" />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export function RequireOrganizationRole({
  roles,
  children,
}: {
  roles: readonly OrganizationRole[];
  children: ReactNode;
}) {
  const { isTenantReady, selectedOrganization } = useOrganization();
  const location = useLocation();

  if (!isTenantReady || selectedOrganization === null) {
    return <FullPageLoader label="Preparando organización…" />;
  }

  if (!hasOrganizationRole(selectedOrganization.role, roles)) {
    return <Navigate to="/app/dashboard" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { status, organizations, platformRole } = useAuth();

  if (status === 'loading') {
    return <FullPageLoader label="Restaurando sesión…" />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  if (!isPlatformAdmin(platformRole)) {
    return (
      <Navigate
        to={resolveDefaultAuthenticatedPath({
          organizationsCount: organizations.length,
          platformRole,
        })}
        replace
      />
    );
  }

  return children;
}

export function GuestRoute() {
  const { status, organizations, platformRole } = useAuth();
  const location = useLocation();
  const redirectTarget =
    (location.state as { from?: string } | null)?.from ??
    resolveDefaultAuthenticatedPath({
      organizationsCount: organizations.length,
      platformRole,
    });

  if (status === 'loading') {
    return <FullPageLoader label="Cargando…" />;
  }

  if (status === 'authenticated') {
    return <Navigate to={redirectTarget} replace />;
  }

  return <Outlet />;
}
