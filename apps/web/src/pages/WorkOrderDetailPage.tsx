import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';

import { getAssetRequest, listAssetsRequest } from '../api/assets.api';
import { ApiError, messageForApiError, TenantNotReadyError } from '../api/api-client';
import { getCustomerRequest } from '../api/customers.api';
import { listOrganizationMembersRequest } from '../api/organization-members.api';
import type { OrganizationMember } from '../api/organization-members.api';
import { listCustomersRequest } from '../api/customers.api';
import {
  changeWorkOrderStatus,
  getWorkOrder,
  updateWorkOrder,
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
import {
  fromDatetimeLocalInputValue,
  toDatetimeLocalInputValue,
} from '../lib/datetime-local';
import { formatDisplayDate } from '../lib/dates';
import { customerTypeLabel, workOrderStatusLabel } from '../lib/labels';
import {
  getAllowedStatusTargets,
  isWorkOrderClosed,
} from '../lib/work-order-status';
import { WorkOrderInspectionsTab } from '../components/inspections/WorkOrderInspectionsTab';
import { WorkOrderPhotosTab } from '../components/media/WorkOrderPhotosTab';
import { WorkOrderEstimatesTab } from '../components/estimates/WorkOrderEstimatesTab';
import { formatUserDisplayName } from '../lib/user';
import './work-order-detail.css';

type DetailTab = 'resumen' | 'inspecciones' | 'fotos' | 'cotizaciones';

function messageForWorkOrderDetailError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return 'Orden de trabajo no encontrada.';
    }
    if (error.status === 403) {
      return 'No tienes acceso a esta orden.';
    }
    if (error.status === 409) {
      if (error.message.toLowerCase().includes('closed')) {
        return 'Esta orden está cerrada y ya no admite cambios.';
      }
      if (error.message.toLowerCase().includes('transition')) {
        return 'No se puede cambiar a ese estado en este momento.';
      }
      return 'No se pudo completar la acción por un conflicto con el estado actual.';
    }
  }

  return messageForApiError(error);
}

export function WorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const { selectedOrganization, isTenantReady } = useOrganization();
  const loadRequestId = useRef(0);
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [customerDetails, setCustomerDetails] = useState<Customer | null>(null);
  const [assetDetails, setAssetDetails] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('resumen');
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const closed = workOrder !== null && isWorkOrderClosed(workOrder.status);

  const allowedStatusTargets = useMemo(() => {
    if (workOrder === null || selectedOrganization === null || closed) {
      return [] as WorkOrderStatus[];
    }
    return getAllowedStatusTargets(
      workOrder.status,
      selectedOrganization.role,
    );
  }, [workOrder, selectedOrganization, closed]);

  const loadWorkOrder = useCallback(async () => {
    if (workOrderId === undefined || !isTenantReady || selectedOrganization === null) {
      return;
    }

    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(null);
    setCustomerDetails(null);
    setAssetDetails(null);

    try {
      const order = await getWorkOrder(workOrderId);
      if (requestId !== loadRequestId.current) {
        return;
      }
      setWorkOrder(order);
      document.title = `Orden #${order.number} · Evolqity Ops`;

      const [customerResult, assetResult] = await Promise.all([
        getCustomerRequest(order.customer.id).catch(() => null),
        order.asset === null
          ? Promise.resolve(null)
          : getAssetRequest(order.asset.id).catch(() => null),
      ]);
      if (requestId !== loadRequestId.current) {
        return;
      }
      setCustomerDetails(customerResult);
      setAssetDetails(assetResult);
    } catch (caught) {
      if (requestId !== loadRequestId.current) {
        return;
      }
      if (caught instanceof TenantNotReadyError) {
        return;
      }
      setWorkOrder(null);
      setError(messageForWorkOrderDetailError(caught));
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false);
      }
    }
  }, [isTenantReady, selectedOrganization, workOrderId]);

  useEffect(() => {
    if (!isTenantReady) {
      setLoading(true);
      return;
    }
    void loadWorkOrder();
  }, [isTenantReady, loadWorkOrder]);

  async function handleStatusChange(nextStatus: WorkOrderStatus) {
    if (workOrderId === undefined) {
      return;
    }

    setSuccessMessage(null);
    try {
      const updated = await changeWorkOrderStatus(workOrderId, nextStatus);
      setWorkOrder(updated);
      setStatusModalOpen(false);
      setSuccessMessage(
        `Estado actualizado a ${workOrderStatusLabel(updated.status)}.`,
      );
    } catch (caught) {
      setError(messageForWorkOrderDetailError(caught));
    }
  }

  if (loading) {
    return (
      <div className="app-page">
        <p className="app-muted" role="status">
          Cargando orden de trabajo…
        </p>
      </div>
    );
  }

  if (error !== null && workOrder === null) {
    return (
      <div className="app-page">
        <Link to="/app/work-orders" className="wo-back-link">
          ← Volver a órdenes
        </Link>
        <p className="app-alert app-alert--error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (workOrder === null) {
    return null;
  }

  return (
    <div className="app-page wo-detail">
      <Link to="/app/work-orders" className="wo-back-link">
        ← Volver a órdenes
      </Link>

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

      {closed ? (
        <p className="app-alert app-alert--info" role="status">
          Esta orden está {workOrderStatusLabel(workOrder.status).toLowerCase()}{' '}
          y es de solo lectura.
        </p>
      ) : null}

      <header className="wo-detail-header">
        <div>
          <p className="wo-detail-kicker">Orden de trabajo #{workOrder.number}</p>
          <h1>{workOrder.title}</h1>
          <div className="wo-detail-badges">
            <WorkOrderStatusBadge status={workOrder.status} />
            <WorkOrderPriorityBadge priority={workOrder.priority} />
          </div>
        </div>

        {!closed ? (
          <div className="wo-detail-actions">
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={allowedStatusTargets.length === 0}
              onClick={() => {
                setError(null);
                setStatusModalOpen(true);
              }}
            >
              Cambiar estado
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={() => {
                setError(null);
                setEditModalOpen(true);
              }}
            >
              Editar orden
            </button>
          </div>
        ) : null}
      </header>

      <nav className="wo-tabs" aria-label="Secciones de la orden">
        {(
          [
            ['resumen', 'Resumen'],
            ['inspecciones', 'Inspecciones'],
            ['fotos', 'Fotos'],
            ['cotizaciones', 'Cotizaciones'],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={
              activeTab === tab ? 'wo-tab is-active' : 'wo-tab'
            }
            aria-current={activeTab === tab ? 'page' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'resumen' ? (
        <WorkOrderSummaryTab
          workOrder={workOrder}
          customerDetails={customerDetails}
          assetDetails={assetDetails}
        />
      ) : null}

      {activeTab === 'inspecciones' ? (
        <WorkOrderInspectionsTab
          workOrderId={workOrder.id}
          workOrderClosed={closed}
        />
      ) : null}

      {activeTab === 'fotos' ? (
        <WorkOrderPhotosTab
          workOrderId={workOrder.id}
          workOrderClosed={closed}
        />
      ) : null}

      {activeTab === 'cotizaciones' ? (
        <WorkOrderEstimatesTab
          workOrderId={workOrder.id}
          workOrderClosed={closed}
        />
      ) : null}

      <StatusChangeModal
        open={statusModalOpen}
        targets={allowedStatusTargets}
        onClose={() => setStatusModalOpen(false)}
        onSelect={async (status) => {
          await handleStatusChange(status);
        }}
      />

      <EditWorkOrderModal
        open={editModalOpen}
        workOrder={workOrder}
        organizationId={selectedOrganization?.id ?? null}
        onClose={() => setEditModalOpen(false)}
        onSaved={(updated) => {
          setWorkOrder(updated);
          setEditModalOpen(false);
          setSuccessMessage('Orden actualizada correctamente.');
          void loadWorkOrder();
        }}
        onError={(message) => setError(message)}
      />
    </div>
  );
}

function WorkOrderSummaryTab({
  workOrder,
  customerDetails,
  assetDetails,
}: {
  workOrder: WorkOrder;
  customerDetails: Customer | null;
  assetDetails: Asset | null;
}) {
  return (
    <div className="wo-card-grid">
      <section className="app-panel wo-card" aria-labelledby="wo-customer-heading">
        <h2 id="wo-customer-heading">Cliente</h2>
        <dl className="wo-dl">
          <div>
            <dt>Nombre</dt>
            <dd>{workOrder.customer.name}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{customerTypeLabel(workOrder.customer.type)}</dd>
          </div>
          {customerDetails?.email ? (
            <div>
              <dt>Correo</dt>
              <dd>
                <a href={`mailto:${customerDetails.email}`}>
                  {customerDetails.email}
                </a>
              </dd>
            </div>
          ) : null}
          {customerDetails?.phone ? (
            <div>
              <dt>Teléfono</dt>
              <dd>
                <a href={`tel:${customerDetails.phone}`}>
                  {customerDetails.phone}
                </a>
              </dd>
            </div>
          ) : null}
          {customerDetails?.identification ? (
            <div>
              <dt>Identificación</dt>
              <dd>{customerDetails.identification}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="app-panel wo-card" aria-labelledby="wo-asset-heading">
        <h2 id="wo-asset-heading">Activo</h2>
        {workOrder.asset === null ? (
          <p className="app-muted">Sin activo asociado.</p>
        ) : (
          <dl className="wo-dl">
            <div>
              <dt>Nombre</dt>
              <dd>{workOrder.asset.name}</dd>
            </div>
            {workOrder.asset.plate ? (
              <div>
                <dt>Placa</dt>
                <dd>{workOrder.asset.plate}</dd>
              </div>
            ) : null}
            {workOrder.asset.make ? (
              <div>
                <dt>Marca</dt>
                <dd>{workOrder.asset.make}</dd>
              </div>
            ) : null}
            {workOrder.asset.model ? (
              <div>
                <dt>Modelo</dt>
                <dd>{workOrder.asset.model}</dd>
              </div>
            ) : null}
            {assetDetails?.year !== null && assetDetails?.year !== undefined ? (
              <div>
                <dt>Año</dt>
                <dd>{assetDetails.year}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </section>

      <section
        className="app-panel wo-card wo-card--wide"
        aria-labelledby="wo-work-heading"
      >
        <h2 id="wo-work-heading">Información del trabajo</h2>
        <dl className="wo-dl">
          <div>
            <dt>Descripción</dt>
            <dd>{workOrder.description ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="app-panel wo-card wo-card--wide" aria-labelledby="wo-dates-heading">
        <h2 id="wo-dates-heading">Fechas y asignación</h2>
        <dl className="wo-dl wo-dl--columns">
          <div>
            <dt>Creada</dt>
            <dd>{formatDisplayDate(workOrder.createdAt) ?? '—'}</dd>
          </div>
          <div>
            <dt>Programada</dt>
            <dd>{formatDisplayDate(workOrder.scheduledAt) ?? '—'}</dd>
          </div>
          <div>
            <dt>Inicio</dt>
            <dd>{formatDisplayDate(workOrder.startedAt) ?? '—'}</dd>
          </div>
          {workOrder.completedAt !== null ? (
            <div>
              <dt>Completada</dt>
              <dd>{formatDisplayDate(workOrder.completedAt) ?? '—'}</dd>
            </div>
          ) : null}
          {workOrder.cancelledAt !== null ? (
            <div>
              <dt>Cancelada</dt>
              <dd>{formatDisplayDate(workOrder.cancelledAt) ?? '—'}</dd>
            </div>
          ) : null}
          <div>
            <dt>Asignado a</dt>
            <dd>
              {workOrder.assignedTo === null
                ? 'Sin asignar'
                : formatUserDisplayName(workOrder.assignedTo.user)}
            </dd>
          </div>
          <div>
            <dt>Creada por</dt>
            <dd>{formatUserDisplayName(workOrder.createdBy.user)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function StatusChangeModal({
  open,
  targets,
  onClose,
  onSelect,
}: {
  open: boolean;
  targets: WorkOrderStatus[];
  onClose: () => void;
  onSelect: (status: WorkOrderStatus) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      setPending(false);
    }
  }, [open]);

  return (
    <Modal
      title="Cambiar estado"
      description="Elige el siguiente estado operativo de la orden."
      open={open}
      onClose={onClose}
      showCloseButton
    >
      {targets.length === 0 ? (
        <p className="app-muted">No hay transiciones disponibles.</p>
      ) : (
        <ul className="wo-status-actions">
          {targets.map((status) => (
            <li key={status}>
              <button
                type="button"
                className="app-button app-button--secondary app-button--block"
                disabled={pending}
                onClick={() => {
                  void (async () => {
                    setPending(true);
                    try {
                      await onSelect(status);
                    } finally {
                      setPending(false);
                    }
                  })();
                }}
              >
                {workOrderStatusLabel(status)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          onClick={onClose}
          disabled={pending}
        >
          Cancelar
        </button>
      </ModalFooter>
    </Modal>
  );
}

function EditWorkOrderModal({
  open,
  workOrder,
  organizationId,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  workOrder: WorkOrder;
  organizationId: string | null;
  onClose: () => void;
  onSaved: (order: WorkOrder) => void;
  onError: (message: string) => void;
}) {
  const { isTenantReady } = useOrganization();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [customerId, setCustomerId] = useState(workOrder.customer.id);
  const [assetId, setAssetId] = useState(workOrder.asset?.id ?? '');
  const [title, setTitle] = useState(workOrder.title);
  const [description, setDescription] = useState(workOrder.description ?? '');
  const [priority, setPriority] = useState(workOrder.priority);
  const [assignedToMembershipId, setAssignedToMembershipId] = useState(
    workOrder.assignedTo?.membershipId ?? '',
  );
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    toDatetimeLocalInputValue(workOrder.scheduledAt),
  );
  const [pending, setPending] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const assigneeOptions = useMemo(() => {
    const activeMembers = members.filter((member) => member.active);
    const currentId = workOrder.assignedTo?.membershipId;
    if (
      currentId !== undefined &&
      !activeMembers.some((member) => member.id === currentId)
    ) {
      const currentInactive = members.find((member) => member.id === currentId);
      if (currentInactive !== undefined) {
        return [...activeMembers, currentInactive];
      }
    }
    return activeMembers;
  }, [members, workOrder.assignedTo?.membershipId]);

  useEffect(() => {
    if (!open || organizationId === null || !isTenantReady) {
      return;
    }

    setCustomerId(workOrder.customer.id);
    setAssetId(workOrder.asset?.id ?? '');
    setTitle(workOrder.title);
    setDescription(workOrder.description ?? '');
    setPriority(workOrder.priority);
    setAssignedToMembershipId(workOrder.assignedTo?.membershipId ?? '');
    setScheduledAtLocal(toDatetimeLocalInputValue(workOrder.scheduledAt));

    let cancelled = false;

    async function loadOptions() {
      setLoadingOptions(true);
      try {
        const [customerResult, memberList] = await Promise.all([
          listCustomersRequest({ active: true, limit: 100, page: 1 }),
          listOrganizationMembersRequest(organizationId as string),
        ]);
        if (!cancelled) {
          setCustomers(customerResult.data);
          setMembers(memberList);
        }
      } catch (caught) {
        if (!cancelled) {
          onError(messageForWorkOrderDetailError(caught));
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [isTenantReady, open, organizationId, workOrder, onError]);

  useEffect(() => {
    if (!open || customerId === '') {
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
          if (
            assetId !== '' &&
            !result.data.some((asset) => asset.id === assetId)
          ) {
            setAssetId('');
          }
        }
      } catch (caught) {
        if (!cancelled) {
          onError(messageForWorkOrderDetailError(caught));
        }
      }
    }

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [open, customerId, assetId, onError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    try {
      const updated = await updateWorkOrder(workOrder.id, {
        customerId,
        assetId: assetId === '' ? null : assetId,
        title: title.trim(),
        description: description.trim() === '' ? null : description.trim(),
        priority,
        assignedToMembershipId:
          assignedToMembershipId === '' ? null : assignedToMembershipId,
        scheduledAt: fromDatetimeLocalInputValue(scheduledAtLocal),
      });
      onSaved(updated);
    } catch (caught) {
      onError(messageForWorkOrderDetailError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="Editar orden de trabajo"
      description="Actualiza los datos operativos mientras la orden permanezca abierta."
      open={open}
      onClose={onClose}
      size="wide"
    >
      <form className="app-modal-form" onSubmit={handleSubmit}>
        <div className="app-field app-field--full">
          <label htmlFor="edit-wo-customer">Cliente</label>
          <select
            id="edit-wo-customer"
            value={customerId}
            disabled={pending || loadingOptions}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setAssetId('');
            }}
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="edit-wo-asset">Activo</label>
          <select
            id="edit-wo-asset"
            value={assetId}
            disabled={pending || assets.length === 0}
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
          <label htmlFor="edit-wo-title">Título</label>
          <input
            id="edit-wo-title"
            required
            minLength={2}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="edit-wo-description">Descripción</label>
          <textarea
            id="edit-wo-description"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={pending}
          />
        </div>

        <div className="app-field">
          <label htmlFor="edit-wo-priority">Prioridad</label>
          <select
            id="edit-wo-priority"
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

        <div className="app-field">
          <label htmlFor="edit-wo-assigned">Asignado a</label>
          <select
            id="edit-wo-assigned"
            value={assignedToMembershipId}
            onChange={(event) => setAssignedToMembershipId(event.target.value)}
            disabled={pending || loadingOptions}
          >
            <option value="">Sin asignar</option>
            {assigneeOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {formatUserDisplayName(member.user)}
              </option>
            ))}
          </select>
        </div>

        <div className="app-field app-field--full">
          <label htmlFor="edit-wo-scheduled">Fecha programada</label>
          <input
            id="edit-wo-scheduled"
            type="datetime-local"
            value={scheduledAtLocal}
            onChange={(event) => setScheduledAtLocal(event.target.value)}
            disabled={pending}
          />
        </div>

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
            {pending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
