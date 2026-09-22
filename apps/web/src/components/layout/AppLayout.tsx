import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo } from 'react';

import { useAuth } from '../../contexts/AuthContext';
import { useOrganization } from '../../contexts/OrganizationContext';
import { filterAppNavigation, isAppPathAllowedForRole } from '../../lib/app-navigation';
import { isPlatformAdmin } from '../../lib/platform';
import { formatUserDisplayName } from '../../lib/user';
import './app-layout.css';

export function AppLayout() {
  const { user, logout, platformRole } = useAuth();
  const {
    selectedOrganization,
    organizations,
    selectOrganization,
    isTenantReady,
  } = useOrganization();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = useMemo(() => {
    if (!isTenantReady || selectedOrganization === null) {
      return [];
    }
    return filterAppNavigation(selectedOrganization.role);
  }, [isTenantReady, selectedOrganization]);

  useEffect(() => {
    if (!isTenantReady || selectedOrganization === null) {
      return;
    }
    if (!isAppPathAllowedForRole(location.pathname, selectedOrganization.role)) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [
    isTenantReady,
    selectedOrganization,
    location.pathname,
    navigate,
  ]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#app-main">
        Saltar al contenido
      </a>

      <aside className="app-sidebar" aria-label="Navegación principal">
        <div className="app-brand">
          <img
            src="/evolqity_ico.png"
            alt="Evolqity"
            className="auth-brand-logo"
          />
          <div>
            <p className="app-brand-name">Evolqity Portal</p>
            <p className="app-brand-tag">Operaciones</p>
          </div>
        </div>

        <nav className="app-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'app-nav-link is-active' : 'app-nav-link'
              }
              onClick={() => {
                document.body.classList.remove('app-mobile-nav-open');
              }}
            >
              {item.label}
            </NavLink>
          ))}
          {isPlatformAdmin(platformRole) ? (
            <>
              <p className="app-nav-section-label">Administración</p>
              <NavLink
                to="/app/platform/organizations"
                className={({ isActive }) =>
                  isActive ? 'app-nav-link is-active' : 'app-nav-link'
                }
                onClick={() => {
                  document.body.classList.remove('app-mobile-nav-open');
                }}
              >
                Organizaciones
              </NavLink>
            </>
          ) : null}
        </nav>
      </aside>

      <div className="app-main-column">
        <header className="app-topbar">
          <button
            type="button"
            className="app-menu-button"
            aria-label="Abrir menú"
            onClick={() => {
              document.body.classList.toggle('app-mobile-nav-open');
            }}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className="app-topbar-meta">
            {organizations.length > 1 ? (
              <label className="app-org-switch">
                <span className="visually-hidden">Organización</span>
                <select
                  value={selectedOrganization?.id ?? ''}
                  onChange={(event) => {
                    selectOrganization(event.target.value);
                  }}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="app-org-name">{selectedOrganization?.name}</p>
            )}

            {user !== null ? (
              <p className="app-user-name">{formatUserDisplayName(user)}</p>
            ) : null}
          </div>

          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={() => {
              void handleLogout();
            }}
          >
            Cerrar sesión
          </button>
        </header>

        <main id="app-main" className="app-content">
          <Outlet />
        </main>

        <footer className="app-footer">
          © {new Date().getFullYear()} Evolqity Portal · Operaciones
        </footer>
      </div>

      <div
        className="app-mobile-backdrop"
        role="presentation"
        onClick={() => {
          document.body.classList.remove('app-mobile-nav-open');
        }}
      />
    </div>
  );
}
