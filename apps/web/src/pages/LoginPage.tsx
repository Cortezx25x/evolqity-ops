import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, messageForApiError } from '../api/api-client';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await login(email.trim(), password);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError(messageForApiError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="app-brand-mark" aria-hidden="true">
            E
          </span>
          <div>
            <h1>Evolqity Ops</h1>
            <p className="auth-subtitle">
              Gestión de talleres y operaciones de servicio
            </p>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="app-field">
            <label htmlFor="login-email">Correo electrónico</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </div>

          <div className="app-field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
          </div>

          {error !== null ? (
            <p className="app-alert app-alert--error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="app-button app-button--primary app-button--block"
            disabled={pending}
          >
            {pending ? 'Iniciando sesión…' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="auth-footnote">
          ¿Buscas aprobar una cotización?{' '}
          <Link to="/estimate">Abrir enlace público</Link>
        </p>
      </div>
    </div>
  );
}
