import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../contexts/AuthContext';
import {
  activatePlatformOrganizationRequest,
  deactivatePlatformOrganizationRequest,
  listPlatformOrganizationsRequest,
  updatePlatformOrganizationRequest,
  type PlatformOrganizationDetail,
  type PlatformOrganizationSummary,
} from '../api/platform-organizations.api';
import { formatCompactDate } from '../lib/dates';
import { messageForPlatformApiError } from '../lib/platform-messages';
import { formatUserDisplayName } from '../lib/user';
import { Modal, ModalFooter } from '../components/Modal';
import '../components/layout/platform-layout.css';

const ORGANIZATION_NAME_MIN_LENGTH = 2;
const ORGANIZATION_NAME_MAX_LENGTH = 200;

type StatusFilter = 'all' | 'active' | 'inactive';

function detailToSummary(
  detail: PlatformOrganizationDetail,
): PlatformOrganizationSummary {
  return {
    id: detail.id,
    name: detail.name,
    active: detail.active,
    createdAt: detail.createdAt,
    owner: detail.owner,
    activeMemberCount: detail.activeMemberCount,
  };
}

function isNameValid(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= ORGANIZATION_NAME_MIN_LENGTH &&
    trimmed.length <= ORGANIZATION_NAME_MAX_LENGTH
  );
}

export function PlatformOrganizationsPage() {
  const { refreshProfile } = useAuth();
  const [rows, setRows] = useState<PlatformOrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [resultTotal, setResultTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] =
    useState<PlatformOrganizationSummary | null>(null);
  const [activateTarget, setActivateTarget] =
    useState<PlatformOrganizationSummary | null>(null);
  const [editTarget, setEditTarget] =
    useState<PlatformOrganizationSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listPlatformOrganizationsRequest({
        search: search === '' ? undefined : search,
        status:
          statusFilter === 'all'
            ? undefined
            : statusFilter === 'active'
              ? 'active'
              : 'inactive',
        page,
        limit: 20,
      });
      setRows(response.data);
      setTotalPages(response.pagination.totalPages);
      setResultTotal(response.pagination.total);
    } catch (caught) {
      setError(messageForPlatformApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const hasActiveFilters = search !== '' || statusFilter !== 'all';

  function emptyMessage(): string {
    if (hasActiveFilters) {
      return 'No se encontraron organizaciones.';
    }
    return 'Aún no hay organizaciones registradas.';
  }

  function mergeUpdatedOrganization(updated: PlatformOrganizationSummary) {
    setRows((current) =>
      current.map((row) => (row.id === updated.id ? updated : row)),
    );
    setEditTarget((current) =>
      current?.id === updated.id ? updated : current,
    );
  }

  return (
    <section className="app-panel">
      <header className="platform-page-header">
        <div>
          <h1>Organizaciones</h1>
          <p className="app-muted">
            Administra las organizaciones registradas en Evolqity.
          </p>
        </div>
        {!loading && resultTotal > 0 ? (
          <p className="platform-result-count app-muted" role="status">
            {hasActiveFilters
              ? `${resultTotal} resultado${resultTotal === 1 ? '' : 's'}`
              : `${resultTotal} organización${resultTotal === 1 ? '' : 'es'}`}
          </p>
        ) : null}
      </header>

      {success !== null ? (
        <p className="app-alert app-alert--success" role="status">
          {success}
        </p>
      ) : null}
      {error !== null ? (
        <p className="app-alert app-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="platform-filters" onSubmit={handleSearchSubmit}>
        <div className="app-field">
          <label htmlFor="platform-org-search">Buscar</label>
          <input
            id="platform-org-search"
            className="app-input"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nombre de la organización"
          />
        </div>
        <div className="app-field">
          <label htmlFor="platform-org-status">Estado</label>
          <select
            id="platform-org-status"
            className="app-input"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="all">Todas</option>
            <option value="active">Activas</option>
            <option value="inactive">Inactivas</option>
          </select>
        </div>
        <button type="submit" className="app-button app-button--secondary">
          Buscar
        </button>
      </form>

      {loading ? (
        <p className="app-muted" role="status">
          Cargando organizaciones…
        </p>
      ) : rows.length === 0 ? (
        <p className="app-empty-inline">{emptyMessage()}</p>
      ) : (
        <div className="platform-org-table">
          <div className="platform-org-table-head" aria-hidden="true">
            <span>Organización</span>
            <span>Owner</span>
            <span>Miembros</span>
            <span>Creada</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          <ul className="platform-org-list">
            {rows.map((organization) => (
              <li key={organization.id}>
                <article className="platform-org-card platform-org-row">
                  <div className="platform-org-cell platform-org-cell--name">
                    <h2>{organization.name}</h2>
                  </div>
                  <div className="platform-org-cell platform-org-cell--owner">
                    <span className="platform-org-cell-label">Owner</span>
                    {organization.owner !== null ? (
                      <>
                        <p className="platform-org-owner-name">
                          {formatUserDisplayName(organization.owner)}
                        </p>
                        <p className="platform-org-owner-email">
                          {organization.owner.email}
                        </p>
                      </>
                    ) : (
                      <p>Sin owner activo</p>
                    )}
                  </div>
                  <div className="platform-org-cell platform-org-cell--members">
                    <span className="platform-org-cell-label">
                      Miembros activos
                    </span>
                    <p>{organization.activeMemberCount}</p>
                  </div>
                  <div className="platform-org-cell platform-org-cell--created">
                    <span className="platform-org-cell-label">Creada</span>
                    <p>{formatCompactDate(organization.createdAt)}</p>
                  </div>
                  <div className="platform-org-cell platform-org-cell--status">
                    <span
                      className={
                        organization.active
                          ? 'status-badge status-badge--success'
                          : 'status-badge status-badge--warning'
                      }
                    >
                      {organization.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <div className="platform-org-cell platform-org-cell--actions platform-org-actions">
                    <button
                      type="button"
                      className="app-button app-button--secondary"
                      disabled={pendingId === organization.id}
                      onClick={() => {
                        setSuccess(null);
                        setEditTarget(organization);
                      }}
                    >
                      Ver / Editar
                    </button>
                    {organization.active ? (
                      <button
                        type="button"
                        className="app-button app-button--danger"
                        disabled={pendingId === organization.id}
                        onClick={() => setDeactivateTarget(organization)}
                      >
                        Desactivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="app-button app-button--primary"
                        disabled={pendingId === organization.id}
                        onClick={() => setActivateTarget(organization)}
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="app-pagination">
          <button
            type="button"
            className="app-button app-button--ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </button>
          <span className="app-muted">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            className="app-button app-button--ghost"
            disabled={page >= totalPages || loading}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            Siguiente
          </button>
        </div>
      ) : null}

      <EditOrganizationModal
        organization={editTarget}
        pending={pendingId !== null}
        onClose={() => {
          if (pendingId === null) {
            setEditTarget(null);
          }
        }}
        onSave={async (name) => {
          if (editTarget === null) {
            return;
          }
          setPendingId(editTarget.id);
          setError(null);
          try {
            const updated = await updatePlatformOrganizationRequest(
              editTarget.id,
              { name: name.trim() },
            );
            const summary = detailToSummary(updated);
            mergeUpdatedOrganization(summary);
            setEditTarget(null);
            setSuccess('Organización actualizada correctamente.');
            await refreshProfile();
          } catch (caught) {
            setError(messageForPlatformApiError(caught));
          } finally {
            setPendingId(null);
          }
        }}
      />

      <DeactivateOrganizationModal
        organization={deactivateTarget}
        pending={pendingId !== null}
        onClose={() => {
          if (pendingId === null) {
            setDeactivateTarget(null);
          }
        }}
        onConfirm={async () => {
          if (deactivateTarget === null) {
            return;
          }
          setPendingId(deactivateTarget.id);
          setError(null);
          try {
            const updated = await deactivatePlatformOrganizationRequest(
              deactivateTarget.id,
            );
            mergeUpdatedOrganization(updated);
            setDeactivateTarget(null);
            setSuccess('Organización desactivada.');
            await refreshProfile();
            await load();
          } catch (caught) {
            setError(messageForPlatformApiError(caught));
          } finally {
            setPendingId(null);
          }
        }}
      />

      <ActivateOrganizationModal
        organization={activateTarget}
        pending={pendingId !== null}
        onClose={() => {
          if (pendingId === null) {
            setActivateTarget(null);
          }
        }}
        onConfirm={async () => {
          if (activateTarget === null) {
            return;
          }
          setPendingId(activateTarget.id);
          setError(null);
          try {
            const updated = await activatePlatformOrganizationRequest(
              activateTarget.id,
            );
            mergeUpdatedOrganization(updated);
            setActivateTarget(null);
            setSuccess('Organización reactivada.');
            await refreshProfile();
            await load();
          } catch (caught) {
            setError(messageForPlatformApiError(caught));
          } finally {
            setPendingId(null);
          }
        }}
      />
    </section>
  );
}

function EditOrganizationModal({
  organization,
  pending,
  onClose,
  onSave,
}: {
  organization: PlatformOrganizationSummary | null;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (organization !== null) {
      setName(organization.name);
    }
  }, [organization]);

  const trimmedName = name.trim();
  const unchanged =
    organization !== null && trimmedName === organization.name.trim();
  const canSave =
    organization !== null &&
    isNameValid(name) &&
    !unchanged &&
    !pending;

  return (
    <Modal
      open={organization !== null}
      title="Editar organización"
      onClose={onClose}
    >
      {organization !== null ? (
        <form
          id="platform-edit-org-form"
          className="platform-edit-org-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) {
              return;
            }
            void onSave(name);
          }}
        >
          <dl className="platform-edit-org-context">
            <div>
              <dt>Estado</dt>
              <dd>
                {organization.active ? (
                  <span className="status-badge status-badge--success">
                    Activa
                  </span>
                ) : (
                  <span className="status-badge status-badge--warning">
                    Inactiva
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>
                {organization.owner !== null
                  ? `${formatUserDisplayName(organization.owner)} (${organization.owner.email})`
                  : 'Sin owner activo'}
              </dd>
            </div>
            <div>
              <dt>Miembros activos</dt>
              <dd>{organization.activeMemberCount}</dd>
            </div>
          </dl>

          <div className="app-field">
            <label htmlFor="platform-edit-org-name">
              Nombre de la organización
            </label>
            <input
              id="platform-edit-org-name"
              className="app-input"
              value={name}
              maxLength={ORGANIZATION_NAME_MAX_LENGTH}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </form>
      ) : null}
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          type="submit"
          form="platform-edit-org-form"
          className="app-button app-button--primary"
          disabled={!canSave}
        >
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function DeactivateOrganizationModal({
  organization,
  pending,
  onClose,
  onConfirm,
}: {
  organization: PlatformOrganizationSummary | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal
      open={organization !== null}
      title="Desactivar organización"
      onClose={onClose}
    >
      {organization !== null ? (
        <p>
          Los usuarios de esta organización perderán acceso a sus operaciones
          hasta que sea reactivada. Los datos no se eliminarán.
        </p>
      ) : null}
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="app-button app-button--danger"
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          {pending ? 'Desactivando…' : 'Desactivar organización'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function ActivateOrganizationModal({
  organization,
  pending,
  onClose,
  onConfirm,
}: {
  organization: PlatformOrganizationSummary | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal
      open={organization !== null}
      title="Reactivar organización"
      onClose={onClose}
    >
      {organization !== null ? (
        <p>
          Los miembros activos podrán volver a utilizar esta organización.
        </p>
      ) : null}
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="app-button app-button--primary"
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          {pending ? 'Reactivando…' : 'Reactivar organización'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
