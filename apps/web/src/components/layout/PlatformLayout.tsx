import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { formatUserDisplayName } from '../../lib/user';
import '../layout/app-layout.css';
import './platform-layout.css';

export function PlatformLayout() {
  const { user, logout, organizations } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell platform-shell">
      <aside className="app-sidebar platform-sidebar" aria-label="Administración de plataforma">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">
            E
          </span>
          <div>
            <p className="app-brand-name">Evolqity Ops</p>
            <p className="app-brand-tag">Administración de plataforma</p>
          </div>
        </div>

        <nav className="app-nav">
          <NavLink
            to="/app/platform/organizations"
            className={({ isActive }) =>
              isActive ? 'app-nav-link is-active' : 'app-nav-link'
            }
          >
            Organizaciones
          </NavLink>
          {organizations.length > 0 ? (
            <NavLink to="/app/dashboard" className="app-nav-link app-nav-link--secondary">
              Ir al taller
            </NavLink>
          ) : null}
        </nav>
      </aside>

      <div className="app-main-column">
        <header className="app-topbar">
          <div className="app-topbar-meta">
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
      </div>
    </div>
  );
}
