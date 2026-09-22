import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, messageForApiError } from '../api/api-client';
import {
  activateOrganizationMemberRequest,
  deactivateOrganizationMemberRequest,
  listOrganizationMembersRequest,
  provisionOrganizationMemberRequest,
  type OrganizationMember,
  type ProvisionOrganizationMemberInput,
} from '../api/organization-members.api';
import { Modal, ModalFooter } from '../components/Modal';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  canManageMemberLifecycle,
  canManageOrganization,
  organizationRoleLabel,
} from '../lib/roles';
import { formatUserDisplayName } from '../lib/user';

const emptyEmployeeForm: ProvisionOrganizationMemberInput = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'MEMBER',
};

export function TeamPage() {
  const { selectedOrganization, isTenantReady } = useOrganization();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] =
    useState<ProvisionOrganizationMemberInput>(emptyEmployeeForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] =
    useState<OrganizationMember | null>(null);
  const [lifecycleMode, setLifecycleMode] = useState<
    'deactivate' | 'reactivate' | null
  >(null);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const canManage =
    selectedOrganization !== null &&
    canManageOrganization(selectedOrganization.role);
  const canProvisionAdmin = selectedOrganization?.role === 'OWNER';

  const loadMembers = useCallback(async () => {
    if (!isTenantReady || selectedOrganization === null) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await listOrganizationMembersRequest(
        selectedOrganization.id,
      );
      setMembers(list);
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [isTenantReady, selectedOrganization]);

  useEffect(() => {
    document.title = 'Equipo · Evolqity Ops';
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const closeDialog = () => {
    if (!submitting) {
      setDialogOpen(false);
      setFormError(null);
    }
  };

  const updateForm = <Key extends keyof ProvisionOrganizationMemberInput,>(
    key: Key,
    value: ProvisionOrganizationMemberInput[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleProvision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (selectedOrganization === null) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSuccess(null);

    try {
      await provisionOrganizationMemberRequest(selectedOrganization.id, {
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
      });
      setDialogOpen(false);
      setForm(emptyEmployeeForm);
      await loadMembers();
      setSuccess('Empleado agregado correctamente.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setFormError('Ya existe una cuenta con este correo.');
      } else if (caught instanceof ApiError && caught.status === 403) {
        setFormError('No tienes permisos para agregar este empleado.');
      } else if (caught instanceof ApiError && caught.status === 400) {
        setFormError(
          'Revisa los datos. La contraseña debe tener entre 10 y 128 caracteres.',
        );
      } else {
        setFormError(messageForApiError(caught));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const closeLifecycleDialog = () => {
    if (!lifecyclePending) {
      setLifecycleTarget(null);
      setLifecycleMode(null);
      setLifecycleError(null);
    }
  };

  const openDeactivateDialog = (member: OrganizationMember) => {
    setSuccess(null);
    setLifecycleError(null);
    setLifecycleTarget(member);
    setLifecycleMode('deactivate');
  };

  const openReactivateDialog = (member: OrganizationMember) => {
    setSuccess(null);
    setLifecycleError(null);
    setLifecycleTarget(member);
    setLifecycleMode('reactivate');
  };

  const handleLifecycleConfirm = async () => {
    if (
      selectedOrganization === null ||
      lifecycleTarget === null ||
      lifecycleMode === null
    ) {
      return;
    }

    setLifecyclePending(true);
    setLifecycleError(null);
    setSuccess(null);

    try {
      if (lifecycleMode === 'deactivate') {
        await deactivateOrganizationMemberRequest(
          selectedOrganization.id,
          lifecycleTarget.id,
        );
        setSuccess('Empleado desactivado.');
      } else {
        await activateOrganizationMemberRequest(
          selectedOrganization.id,
          lifecycleTarget.id,
        );
        setSuccess('Empleado reactivado.');
      }
      setLifecycleTarget(null);
      setLifecycleMode(null);
      setLifecycleError(null);
      await loadMembers();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setLifecycleError('No tienes permisos para administrar este empleado.');
      } else if (caught instanceof ApiError && caught.status === 409) {
        setLifecycleError('No se puede realizar esta acción con este miembro.');
      } else if (caught instanceof ApiError && caught.status === 404) {
        setLifecycleError('Miembro no encontrado.');
      } else {
        setLifecycleError(messageForApiError(caught));
      }
    } finally {
      setLifecyclePending(false);
    }
  };

  const renderMemberActions = (member: OrganizationMember) => {
    if (selectedOrganization === null) {
      return null;
    }

    const { canDeactivate, canReactivate } = canManageMemberLifecycle(
      selectedOrganization.role,
      selectedOrganization.membershipId,
      member,
    );

    if (!canDeactivate && !canReactivate) {
      return null;
    }

    if (canDeactivate) {
      return (
        <button
          type="button"
          className="app-button app-button--danger app-button--compact"
          onClick={() => openDeactivateDialog(member)}
        >
          Desactivar
        </button>
      );
    }

    return (
      <button
        type="button"
        className="app-button app-button--secondary app-button--compact"
        onClick={() => openReactivateDialog(member)}
      >
        Reactivar
      </button>
    );
  };

  return (
    <div className="app-page">
      <header className="app-page-header">
        <div>
          <h1>Equipo</h1>
          <p className="app-page-lead">
            Personas con acceso a esta organización.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={() => {
              setSuccess(null);
              setFormError(null);
              if (!canProvisionAdmin) {
                setForm((current) => ({ ...current, role: 'MEMBER' }));
              }
              setDialogOpen(true);
            }}
          >
            Agregar empleado
          </button>
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

      <section className="app-panel">
        {loading ? (
          <p className="app-muted">Cargando equipo…</p>
        ) : members.length === 0 ? (
          <p className="app-empty-inline">No hay miembros registrados.</p>
        ) : (
          <>
            <div className="list-table-wrap">
              <table className="list-table list-table--team">
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Correo</th>
                    <th scope="col">Rol</th>
                    <th scope="col">Estado</th>
                    {canManage ? <th scope="col" className="col-actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td data-label="Nombre">
                        {formatUserDisplayName(member.user)}
                      </td>
                      <td data-label="Correo">{member.user.email}</td>
                      <td data-label="Rol">
                        {organizationRoleLabel(member.role)}
                      </td>
                      <td data-label="Estado">
                        <span
                          className={
                            member.active
                              ? 'status-badge status-badge--success'
                              : 'status-badge status-badge--muted'
                          }
                        >
                          {member.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      {canManage ? (
                        <td data-label="Acciones" className="col-actions">
                          {renderMemberActions(member)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="list-cards">
              {members.map((member) => (
                <li key={member.id} className="list-card">
                  <div className="list-card-header">
                    <strong>{formatUserDisplayName(member.user)}</strong>
                    <span
                      className={
                        member.active
                          ? 'status-badge status-badge--success'
                          : 'status-badge status-badge--muted'
                      }
                    >
                      {member.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="list-card-meta">{member.user.email}</p>
                  <p className="list-card-meta">
                    Rol: {organizationRoleLabel(member.role)}
                  </p>
                  {canManage ? (
                    <div className="list-card-actions">
                      {renderMemberActions(member)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <Modal
        title="Agregar empleado"
        description="Crea una cuenta con acceso a esta organización."
        open={dialogOpen}
        onClose={closeDialog}
      >
        <form className="app-modal-form" onSubmit={handleProvision}>
          {formError !== null ? (
            <p className="app-alert app-alert--error app-field--full" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="app-field">
            <label htmlFor="employee-first-name">Nombre</label>
            <input
              id="employee-first-name"
              value={form.firstName}
              onChange={(event) => updateForm('firstName', event.target.value)}
              autoComplete="given-name"
              required
              disabled={submitting}
            />
          </div>

          <div className="app-field">
            <label htmlFor="employee-last-name">Apellido</label>
            <input
              id="employee-last-name"
              value={form.lastName}
              onChange={(event) => updateForm('lastName', event.target.value)}
              autoComplete="family-name"
              required
              disabled={submitting}
            />
          </div>

          <div className="app-field app-field--full">
            <label htmlFor="employee-email">Correo</label>
            <input
              id="employee-email"
              type="email"
              value={form.email}
              onChange={(event) => updateForm('email', event.target.value)}
              autoComplete="email"
              required
              disabled={submitting}
            />
          </div>

          <div className="app-field app-field--full">
            <label htmlFor="employee-password">Contraseña inicial</label>
            <input
              id="employee-password"
              type="password"
              value={form.password}
              onChange={(event) => updateForm('password', event.target.value)}
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              aria-describedby="employee-password-help"
              required
              disabled={submitting}
            />
            <span id="employee-password-help" className="app-field-hint">
              Entre 10 y 128 caracteres.
            </span>
          </div>

          <div className="app-field app-field--full">
            <label htmlFor="employee-role">Rol</label>
            <select
              id="employee-role"
              value={form.role}
              onChange={(event) =>
                updateForm(
                  'role',
                  event.target.value as ProvisionOrganizationMemberInput['role'],
                )
              }
              disabled={submitting}
            >
              <option value="MEMBER">Miembro</option>
              {canProvisionAdmin ? (
                <option value="ADMIN">Administrador</option>
              ) : null}
            </select>
          </div>

          <ModalFooter>
            <button
              type="button"
              className="app-button app-button--ghost"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="app-button app-button--primary"
              disabled={submitting}
            >
              {submitting ? 'Creando…' : 'Crear empleado'}
            </button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        title={
          lifecycleMode === 'deactivate'
            ? 'Desactivar empleado'
            : 'Reactivar empleado'
        }
        description={
          lifecycleTarget === null
            ? undefined
            : lifecycleMode === 'deactivate'
              ? `${formatUserDisplayName(lifecycleTarget.user)} ya no podrá acceder a esta organización. Su historial y asignaciones anteriores se conservarán.`
              : `${formatUserDisplayName(lifecycleTarget.user)} recuperará el acceso a esta organización.`
        }
        open={lifecycleTarget !== null && lifecycleMode !== null}
        onClose={closeLifecycleDialog}
      >
        {lifecycleError !== null ? (
          <p className="app-alert app-alert--error" role="alert">
            {lifecycleError}
          </p>
        ) : null}
        <ModalFooter>
          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={closeLifecycleDialog}
            disabled={lifecyclePending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={
              lifecycleMode === 'deactivate'
                ? 'app-button app-button--danger'
                : 'app-button app-button--primary'
            }
            disabled={lifecyclePending}
            onClick={() => {
              void handleLifecycleConfirm();
            }}
          >
            {lifecyclePending
              ? 'Guardando…'
              : lifecycleMode === 'deactivate'
                ? 'Desactivar'
                : 'Reactivar'}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
