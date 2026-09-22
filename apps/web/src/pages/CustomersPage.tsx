import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';

import { Link } from 'react-router-dom';

import { messageForApiError } from '../api/api-client';
import {
  createCustomerRequest,
  listCustomersRequest,
} from '../api/customers.api';
import type { Customer, CustomerType } from '../api/types';
import { Modal, ModalFooter } from '../components/Modal';
import { useOrganization } from '../contexts/OrganizationContext';
import { customerTypeLabel } from '../lib/labels';

export function CustomersPage() {
  const { selectedOrganization, isTenantReady } = useOrganization();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Clientes · Evolqity Ops';
  }, []);

  const loadCustomers = useCallback(async () => {
    if (!isTenantReady || selectedOrganization === null) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listCustomersRequest({
        search,
        page,
        limit: 20,
      });
      setCustomers(result.data);
      setTotalPages(result.pagination.totalPages);
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [isTenantReady, page, search, selectedOrganization]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <div>
          <h1>Clientes</h1>
          <p className="app-page-lead">
            Administra la cartera de clientes del taller.
          </p>
        </div>
        <button
          type="button"
          className="app-button app-button--primary"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          Nuevo cliente
        </button>
      </header>

      {successMessage !== null ? (
        <p className="app-alert app-alert--success" role="status">
          {successMessage}
        </p>
      ) : null}

      {error !== null ? (
        <p className="app-alert app-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="app-panel">
        <form className="app-toolbar" onSubmit={handleSearchSubmit}>
          <label className="app-search">
            <span className="visually-hidden">Buscar clientes</span>
            <input
              type="search"
              placeholder="Buscar por nombre, correo o teléfono"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <button type="submit" className="app-button app-button--secondary">
            Buscar
          </button>
        </form>

        {loading ? (
          <p className="app-muted">Cargando clientes…</p>
        ) : customers.length === 0 ? (
          <p className="app-empty-inline">
            No hay clientes que coincidan con tu búsqueda.
          </p>
        ) : (
          <>
            <div className="list-table-wrap">
              <table className="list-table list-table--customers">
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Tipo</th>
                    <th scope="col" className="col-email">
                      Correo
                    </th>
                    <th scope="col">Teléfono</th>
                    <th scope="col">Estado</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td data-label="Nombre">{customer.name}</td>
                      <td data-label="Tipo">
                        {customerTypeLabel(customer.type)}
                      </td>
                      <td data-label="Correo" className="col-email">
                        {customer.email ?? '—'}
                      </td>
                      <td data-label="Teléfono">{customer.phone ?? '—'}</td>
                      <td data-label="Estado">
                        <span
                          className={
                            customer.active
                              ? 'status-badge status-badge--success'
                              : 'status-badge status-badge--muted'
                          }
                        >
                          {customer.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td data-label="Acciones">
                        <Link
                          className="app-table-link"
                          to={`/app/assets?customerId=${customer.id}`}
                        >
                          Activos
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="list-cards">
              {customers.map((customer) => (
                <li key={customer.id} className="list-card">
                  <div className="list-card-header">
                    <strong>{customer.name}</strong>
                    <span
                      className={
                        customer.active
                          ? 'status-badge status-badge--success'
                          : 'status-badge status-badge--muted'
                      }
                    >
                      {customer.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="list-card-meta">
                    {customerTypeLabel(customer.type)}
                  </p>
                  {customer.email ? (
                    <p className="list-card-meta">{customer.email}</p>
                  ) : null}
                  {customer.phone ? (
                    <p className="list-card-meta">{customer.phone}</p>
                  ) : null}
                  <div className="list-card-actions">
                    <Link
                      className="app-button app-button--secondary app-button--small"
                      to={`/app/assets?customerId=${customer.id}`}
                    >
                      Ver activos
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {totalPages > 1 ? (
          <div className="app-pagination">
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <p className="app-muted">
              Página {page} de {totalPages}
            </p>
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={page >= totalPages || loading}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              Siguiente
            </button>
          </div>
        ) : null}
      </section>

      <CreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          setSuccessMessage('Cliente creado correctamente.');
          setPage(1);
          await loadCustomers();
        }}
      />
    </div>
  );
}

function CreateCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [type, setType] = useState<CustomerType>('PERSON');
  const [name, setName] = useState('');
  const [identification, setIdentification] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setType('PERSON');
      setName('');
      setIdentification('');
      setEmail('');
      setPhone('');
      setNotes('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await createCustomerRequest({
        type,
        name: name.trim(),
        identification: identification.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      await onCreated();
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="Nuevo cliente"
      description="Registra un cliente para asociarlo a activos y órdenes de trabajo."
      open={open}
      onClose={onClose}
    >
      <form className="app-modal-form" onSubmit={handleSubmit}>
        <div className="app-field">
          <label htmlFor="customer-type">Tipo</label>
          <select
            id="customer-type"
            value={type}
            onChange={(event) =>
              setType(event.target.value as CustomerType)
            }
            disabled={pending}
          >
            <option value="PERSON">Persona</option>
            <option value="COMPANY">Empresa</option>
          </select>
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="customer-name">Nombre</label>
          <input
            id="customer-name"
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field">
          <label htmlFor="customer-identification">
            Identificación{' '}
            <span className="app-field-optional">(opcional)</span>
          </label>
          <input
            id="customer-identification"
            value={identification}
            onChange={(event) => setIdentification(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field">
          <label htmlFor="customer-email">
            Correo <span className="app-field-optional">(opcional)</span>
          </label>
          <input
            id="customer-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field">
          <label htmlFor="customer-phone">
            Teléfono <span className="app-field-optional">(opcional)</span>
          </label>
          <input
            id="customer-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="customer-notes">
            Notas <span className="app-field-optional">(opcional)</span>
          </label>
          <textarea
            id="customer-notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={pending}
          />
        </div>

        {error !== null ? (
          <p className="app-alert app-alert--error app-field--full" role="alert">
            {error}
          </p>
        ) : null}

        <ModalFooter>
          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="app-button app-button--primary"
            disabled={pending}
          >
            {pending ? 'Guardando…' : 'Crear cliente'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
