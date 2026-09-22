import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { Link, useLocation } from 'react-router-dom';

import { messageForApiError } from '../api/api-client';
import { listAssetsRequest } from '../api/assets.api';
import { listCustomersRequest } from '../api/customers.api';
import {
  createWorkOrderRequest,
  listWorkOrdersRequest,
} from '../api/work-orders.api';
import type {
  Asset,
  Customer,
  WorkOrder,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../api/types';
import { Modal, ModalFooter } from '../components/Modal';
import {
  WorkOrderPriorityBadge,
  WorkOrderStatusBadge,
} from '../components/WorkOrderStatusBadge';
import { useOrganization } from '../contexts/OrganizationContext';
import { formatCompactDate } from '../lib/dates';
import { workOrderStatusLabel } from '../lib/labels';
import { formatUserDisplayName } from '../lib/user';

const statusFilterOptions: Array<WorkOrderStatus | ''> = [
  '',
  'DRAFT',
  'OPEN',
  'IN_PROGRESS',
  'WAITING',
  'COMPLETED',
  'CANCELLED',
];

export function WorkOrdersPage() {
  const location = useLocation();
  const { selectedOrganization, isTenantReady } = useOrganization();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Órdenes de trabajo · Evolqity Portal';
  }, []);

  useEffect(() => {
    const state = location.state as { openCreate?: boolean } | null;
    if (state?.openCreate) {
      setCreateOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const loadOrders = useCallback(async () => {
    if (!isTenantReady || selectedOrganization === null) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listWorkOrdersRequest({
        search,
        status: statusFilter === '' ? undefined : statusFilter,
        page,
        limit: 20,
      });
      setOrders(result.data);
      setTotalPages(result.pagination.totalPages);
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [isTenantReady, page, search, selectedOrganization, statusFilter]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <div>
          <h1>Órdenes de trabajo</h1>
          <p className="app-page-lead">
            Seguimiento de trabajos activos y pendientes.
          </p>
        </div>
        <button
          type="button"
          className="app-button app-button--primary"
          onClick={() => setCreateOpen(true)}
        >
          Nueva orden
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
        <form className="app-toolbar app-toolbar--wrap" onSubmit={handleSearchSubmit}>
          <label className="app-search">
            <span className="visually-hidden">Buscar órdenes</span>
            <input
              type="search"
              placeholder="Buscar por título, cliente o número"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>

          <label className="app-field app-field--inline">
            <span>Estado</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value as WorkOrderStatus | '');
              }}
            >
              <option value="">Todos</option>
              {statusFilterOptions
                .filter((value) => value !== '')
                .map((status) => (
                  <option key={status} value={status}>
                    {workOrderStatusLabel(status)}
                  </option>
                ))}
            </select>
          </label>

          <button type="submit" className="app-button app-button--secondary">
            Buscar
          </button>
        </form>

        {loading ? (
          <p className="app-muted">Cargando órdenes…</p>
        ) : orders.length === 0 ? (
          <p className="app-empty-inline">
            No hay órdenes que coincidan con los filtros actuales.
          </p>
        ) : (
          <>
            <div className="list-table-wrap">
              <table className="list-table list-table--work-orders">
                <thead>
                  <tr>
                    <th scope="col">Número</th>
                    <th scope="col">Título</th>
                    <th scope="col">Cliente</th>
                    <th scope="col" className="col-asset">
                      Activo
                    </th>
                    <th scope="col">Estado</th>
                    <th scope="col">Prioridad</th>
                    <th scope="col" className="col-assigned">
                      Asignado
                    </th>
                    <th scope="col" className="col-created">
                      Creada
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td data-label="Número">
                        <Link
                          to={`/app/work-orders/${order.id}`}
                          className="app-table-link"
                        >
                          #{order.number}
                        </Link>
                      </td>
                      <td data-label="Título">
                        <Link
                          to={`/app/work-orders/${order.id}`}
                          className="app-table-link"
                        >
                          {order.title}
                        </Link>
                      </td>
                      <td data-label="Cliente">{order.customer.name}</td>
                      <td data-label="Activo" className="col-asset">
                        {order.asset?.name ?? '—'}
                      </td>
                      <td data-label="Estado">
                        <WorkOrderStatusBadge status={order.status} />
                      </td>
                      <td data-label="Prioridad">
                        <WorkOrderPriorityBadge priority={order.priority} />
                      </td>
                      <td data-label="Asignado" className="col-assigned">
                        {order.assignedTo === null
                          ? '—'
                          : formatUserDisplayName(order.assignedTo.user)}
                      </td>
                      <td data-label="Creada" className="col-created">
                        {formatCompactDate(order.createdAt) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="list-cards">
              {orders.map((order) => (
                <li key={order.id} className="list-card">
                  <div className="list-card-header">
                    <Link
                      to={`/app/work-orders/${order.id}`}
                      className="app-table-link"
                    >
                      #{order.number}
                    </Link>
                    <WorkOrderStatusBadge status={order.status} />
                  </div>
                  <p className="list-card-meta">
                    <strong>{order.title}</strong>
                  </p>
                  <p className="list-card-meta">{order.customer.name}</p>
                  {order.asset ? (
                    <p className="list-card-meta">{order.asset.name}</p>
                  ) : null}
                  <p className="list-card-meta">
                    Prioridad:{' '}
                    <WorkOrderPriorityBadge priority={order.priority} />
                  </p>
                  <div className="list-card-actions">
                    <Link
                      className="app-button app-button--primary app-button--small"
                      to={`/app/work-orders/${order.id}`}
                    >
                      Ver orden
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

      <CreateWorkOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          setSuccessMessage('Orden de trabajo creada correctamente.');
          setPage(1);
          await loadOrders();
        }}
      />
    </div>
  );
}

function CreateWorkOrderModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { selectedOrganization, isTenantReady } = useOrganization();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkOrderPriority>('NORMAL');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isTenantReady || selectedOrganization === null) {
      return;
    }

    let cancelled = false;

    async function loadCustomers() {
      setLoadingOptions(true);
      setError(null);
      try {
        const result = await listCustomersRequest({
          active: true,
          limit: 100,
          page: 1,
        });
        if (!cancelled) {
          setCustomers(result.data);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(messageForApiError(caught));
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    void loadCustomers();

    return () => {
      cancelled = true;
    };
  }, [isTenantReady, open, selectedOrganization]);

  useEffect(() => {
    if (!open) {
      setCustomerId('');
      setAssetId('');
      setTitle('');
      setDescription('');
      setPriority('NORMAL');
      setAssets([]);
      setError(null);
      setPending(false);
    }
  }, [open]);

  useEffect(() => {
    if (customerId === '') {
      setAssets([]);
      setAssetId('');
      return;
    }

    let cancelled = false;

    async function loadAssets() {
      try {
        const result = await listAssetsRequest({
          customerId,
          active: true,
          limit: 100,
          page: 1,
        });
        if (!cancelled) {
          setAssets(result.data);
          setAssetId('');
        }
      } catch (caught) {
        if (!cancelled) {
          setError(messageForApiError(caught));
        }
      }
    }

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await createWorkOrderRequest({
        customerId,
        assetId: assetId === '' ? null : assetId,
        title: title.trim(),
        description: description.trim() || null,
        priority,
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
      title="Nueva orden de trabajo"
      description="Selecciona el cliente y describe el trabajo a realizar."
      open={open}
      onClose={onClose}
      size="wide"
    >
      <form className="app-modal-form" onSubmit={handleSubmit}>
        <div className="app-field app-field--full">
          <label htmlFor="wo-customer">Cliente</label>
          <select
            id="wo-customer"
            required
            value={customerId}
            disabled={pending || loadingOptions}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setAssetId('');
            }}
          >
            <option value="">Selecciona un cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="wo-asset">Activo (opcional)</label>
          <select
            id="wo-asset"
            value={assetId}
            disabled={pending || customerId === '' || assets.length === 0}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">Sin activo</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
                {asset.plate ? ` · ${asset.plate}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="wo-title">Título</label>
          <input
            id="wo-title"
            required
            minLength={2}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="wo-description">Descripción</label>
          <textarea
            id="wo-description"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field">
          <label htmlFor="wo-priority">Prioridad</label>
          <select
            id="wo-priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as WorkOrderPriority)
            }
            disabled={pending}
          >
            <option value="LOW">Baja</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Alta</option>
            <option value="URGENT">Urgente</option>
          </select>
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
            disabled={pending || customerId === ''}
          >
            {pending ? 'Creando…' : 'Crear orden'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
