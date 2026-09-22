import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { OrganizationGate } from './components/routing/OrganizationGate';
import {
  GuestRoute,
  ProtectedRoute,
  RequireOrganizationRole,
  RequirePlatformAdmin,
} from './components/routing/RouteGuards';
import { PlatformLayout } from './components/layout/PlatformLayout';
import { ORGANIZATION_TEAM_ROLES } from './lib/roles';
import { AuthProvider } from './contexts/AuthContext';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { CustomersPage } from './pages/CustomersPage';
import { AssetsPage } from './pages/AssetsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import PublicEstimatePage from './pages/PublicEstimatePage';
import { PlatformOrganizationsPage } from './pages/PlatformOrganizationsPage';
import { TeamPage } from './pages/TeamPage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { WorkOrderDetailPage } from './pages/WorkOrderDetailPage';
import './styles/app.css';
import './styles/responsive-lists.css';

function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Página no encontrada</h1>
        <p className="auth-subtitle">
          La ruta solicitada no existe en Evolqity Ops.
        </p>
        <a className="app-button app-button--primary app-button--block" href="/">
          Ir al inicio
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <Routes>
          <Route path="/estimate" element={<PublicEstimatePage />} />

          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route
              path="/app/platform"
              element={
                <RequirePlatformAdmin>
                  <PlatformLayout />
                </RequirePlatformAdmin>
              }
            >
              <Route
                index
                element={<Navigate to="organizations" replace />}
              />
              <Route
                path="organizations"
                element={<PlatformOrganizationsPage />}
              />
            </Route>

            <Route element={<OrganizationGate />}>
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="assets" element={<AssetsPage />} />
                <Route path="work-orders/:workOrderId" element={<WorkOrderDetailPage />} />
                <Route path="work-orders" element={<WorkOrdersPage />} />
                <Route
                  path="team"
                  element={
                    <RequireOrganizationRole roles={ORGANIZATION_TEAM_ROLES}>
                      <TeamPage />
                    </RequireOrganizationRole>
                  }
                />
              </Route>
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </OrganizationProvider>
    </AuthProvider>
  );
}
