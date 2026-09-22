import { useOrganization } from '../contexts/OrganizationContext';

export function OrganizationPickerPage({ error }: { error: string | null }) {
  const { organizations, selectOrganization } = useOrganization();

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        <div className="auth-brand">
          <span className="app-brand-mark" aria-hidden="true">
            E
          </span>
          <div>
            <h1>Selecciona una organización</h1>
            <p className="auth-subtitle">
              Elige el taller con el que deseas trabajar hoy.
            </p>
          </div>
        </div>

        {error !== null ? (
          <p className="app-alert app-alert--error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="org-picker-list">
          {organizations.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                className="org-picker-item"
                onClick={() => {
                  selectOrganization(org.id);
                }}
              >
                <span className="org-picker-name">{org.name}</span>
                <span className="org-picker-meta">{org.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
