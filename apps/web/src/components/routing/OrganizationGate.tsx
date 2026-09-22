import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { useOrganization } from '../../contexts/OrganizationContext';
import { isPlatformAdmin } from '../../lib/platform';
import { OrganizationPickerPage } from '../../pages/OrganizationPickerPage';
import { FullPageLoader } from '../FullPageLoader';

export function OrganizationGate() {
  const { status, platformRole } = useAuth();
  const { phase, error, isTenantReady } = useOrganization();

  if (status === 'loading' || phase === 'idle' || phase === 'loading') {
    return <FullPageLoader label="Preparando organización…" />;
  }

  if (phase === 'empty') {
    if (isPlatformAdmin(platformRole)) {
      return <Navigate to="/app/platform/organizations" replace />;
    }

    return (
      <div className="app-empty-state app-empty-state--standalone">
        <h1>Sin organizaciones</h1>
        <p>
          Tu cuenta no tiene organizaciones activas. Contacta al administrador
          para obtener acceso.
        </p>
      </div>
    );
  }

  if (phase === 'select') {
    return <OrganizationPickerPage error={error} />;
  }

  if (!isTenantReady) {
    return <FullPageLoader label="Preparando organización…" />;
  }

  return <Outlet />;
}
