import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { TenantNotReadyError } from '../../api/api-client';
import {
  addEstimateItemRequest,
  changeEstimateStatusRequest,
  createEstimateRequest,
  deleteEstimateItemRequest,
  getEstimateRequest,
  issueEstimatePublicAccessRequest,
  listEstimatesRequest,
  revokeEstimatePublicAccessRequest,
  updateEstimateItemRequest,
  updateEstimateRequest,
  type EstimateDetail,
  type EstimateItem,
  type EstimateItemType,
  type EstimateSummary,
} from '../../api/estimates.api';
import { useOrganization } from '../../contexts/OrganizationContext';
import { formatCompactDate, formatDisplayDate } from '../../lib/dates';
import {
  ESTIMATE_ITEM_TYPES,
  estimateItemTypeLabel,
  estimateStatusBadgeClass,
  estimateStatusLabel,
  estimateTerminalTimestampLabel,
  fromDateInputValue,
  isEstimateDraft,
  isEstimateTerminal,
  messageForEstimateApiError,
  messageForEstimatePublicAccessError,
  toDateInputValue,
  validateCurrencyCode,
  validateEstimateItemFields,
} from '../../lib/estimates';
import {
  formatMoney,
  formatPercent,
  formatQuantity,
  isZeroMoney,
} from '../../lib/money';
import { canManageOrganization } from '../../lib/roles';
import { Modal, ModalFooter } from '../Modal';
import {
  EstimatePublicAccessSection,
  type EstimatePublicAccessMemory,
} from './EstimatePublicAccessSection';
import './estimates.css';

export interface WorkOrderEstimatesTabProps {
  workOrderId: string;
  workOrderClosed: boolean;
}

export function WorkOrderEstimatesTab({
  workOrderId,
  workOrderClosed,
}: WorkOrderEstimatesTabProps) {
  const { isTenantReady, selectedOrganization } = useOrganization();
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);

  const [summaries, setSummaries] = useState<EstimateSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EstimateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<EstimateItem | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<EstimateItem | null>(
    null,
  );
  const [sendOpen, setSendOpen] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<
    'APPROVED' | 'REJECTED' | 'CANCELLED' | null
  >(null);

  const [createPending, setCreatePending] = useState(false);
  const [editMetaPending, setEditMetaPending] = useState(false);
  const [addItemPending, setAddItemPending] = useState(false);
  const [editItemPending, setEditItemPending] = useState(false);
  const [deleteItemPending, setDeleteItemPending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [statusRefreshPending, setStatusRefreshPending] = useState(false);
  const [publicAccessIssuePending, setPublicAccessIssuePending] = useState(false);
  const [publicAccessRevokePending, setPublicAccessRevokePending] =
    useState(false);
  const [issuedLinks, setIssuedLinks] = useState<
    Record<string, EstimatePublicAccessMemory>
  >({});

  const canManageStatus = canManageOrganization(
    selectedOrganization?.role ?? 'MEMBER',
  );
  const canCreateEstimate = !workOrderClosed;
  const canMutateEstimate =
    !workOrderClosed && detail !== null && isEstimateDraft(detail.status);
  const canManagePublicAccess =
    canManageStatus &&
    !workOrderClosed &&
    detail !== null &&
    detail.status === 'SENT';

  const loadList = useCallback(async () => {
    if (!isTenantReady) {
      return;
    }

    const requestId = ++listRequestId.current;
    setListLoading(true);
    setError(null);

    try {
      const response = await listEstimatesRequest(workOrderId, {
        limit: 100,
      });
      if (requestId !== listRequestId.current) {
        return;
      }
      setSummaries(response.data);
    } catch (caught) {
      if (requestId !== listRequestId.current) {
        return;
      }
      if (caught instanceof TenantNotReadyError) {
        return;
      }
      setError(messageForEstimateApiError(caught));
    } finally {
      if (requestId === listRequestId.current) {
        setListLoading(false);
      }
    }
  }, [isTenantReady, workOrderId]);

  const loadDetail = useCallback(
    async (estimateId: string) => {
      if (!isTenantReady) {
        return;
      }

      const requestId = ++detailRequestId.current;
      setDetailLoading(true);

      try {
        const next = await getEstimateRequest(estimateId);
        if (requestId !== detailRequestId.current) {
          return;
        }
        setDetail(next);
      } catch (caught) {
        if (requestId !== detailRequestId.current) {
          return;
        }
        if (caught instanceof TenantNotReadyError) {
          return;
        }
        setDetail(null);
        setError(messageForEstimateApiError(caught));
      } finally {
        if (requestId === detailRequestId.current) {
          setDetailLoading(false);
        }
      }
    },
    [isTenantReady],
  );

  const refreshAfterMutation = useCallback(
    async (estimateId: string) => {
      await Promise.all([loadList(), loadDetail(estimateId)]);
    },
    [loadList, loadDetail],
  );

  const refreshEstimateDetail = useCallback(
    async (options?: { announceCustomerDecision?: boolean }) => {
      if (selectedId === null || !isTenantReady) {
        return;
      }

      const previousStatus = detail?.status;
      setStatusRefreshPending(true);
      setError(null);

      try {
        const updated = await getEstimateRequest(selectedId);
        setDetail(updated);
        await loadList();
        if (
          options?.announceCustomerDecision &&
          previousStatus === 'SENT' &&
          updated.status !== 'SENT'
        ) {
          if (updated.status === 'APPROVED') {
            setSuccess('El cliente aprobó la cotización.');
          } else if (updated.status === 'REJECTED') {
            setSuccess('El cliente rechazó la cotización.');
          }
        }
      } catch (caught) {
        if (!(caught instanceof TenantNotReadyError)) {
          setError(messageForEstimateApiError(caught));
        }
      } finally {
        setStatusRefreshPending(false);
      }
    },
    [selectedId, isTenantReady, detail?.status, loadList],
  );

  async function handleIssuePublicLink() {
    if (detail === null) {
      throw new Error('missing estimate');
    }

    setPublicAccessIssuePending(true);
    setError(null);
    try {
      const result = await issueEstimatePublicAccessRequest(detail.id);
      setIssuedLinks((current) => ({
        ...current,
        [detail.id]: result,
      }));
      return result;
    } catch (caught) {
      setError(messageForEstimatePublicAccessError(caught));
      throw caught;
    } finally {
      setPublicAccessIssuePending(false);
    }
  }

  async function handleRevokePublicLink() {
    if (detail === null) {
      throw new Error('missing estimate');
    }

    setPublicAccessRevokePending(true);
    setError(null);
    try {
      await revokeEstimatePublicAccessRequest(detail.id);
      setIssuedLinks((current) => {
        if (current[detail.id] === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[detail.id];
        return next;
      });
    } catch (caught) {
      setError(messageForEstimatePublicAccessError(caught));
      throw caught;
    } finally {
      setPublicAccessRevokePending(false);
    }
  }

  useEffect(() => {
    if (detail === null || detail.status === 'SENT') {
      return;
    }
    setIssuedLinks((current) => {
      if (current[detail.id] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[detail.id];
      return next;
    });
  }, [detail?.id, detail?.status]);

  useEffect(() => {
    if (detail?.status !== 'SENT' || selectedId === null) {
      return;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshEstimateDetail({ announceCustomerDecision: true });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [detail?.status, selectedId, refreshEstimateDetail]);

  useEffect(() => {
    if (!isTenantReady) {
      setListLoading(true);
      return;
    }
    void loadList();
  }, [isTenantReady, loadList]);

  useEffect(() => {
    if (selectedId === null || !isTenantReady) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, isTenantReady, loadDetail]);

  useEffect(() => {
    if (summaries.length === 0 || selectedId !== null) {
      return;
    }
    setSelectedId(summaries[0]?.id ?? null);
  }, [summaries, selectedId]);

  async function handleStatusChange(
    status: 'SENT' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
    successMessage: string,
  ) {
    if (detail === null) {
      return;
    }

    setStatusPending(true);
    setError(null);
    try {
      const updated = await changeEstimateStatusRequest(detail.id, { status });
      setDetail(updated);
      setSendOpen(false);
      setStatusConfirm(null);
      setSuccess(successMessage);
      await loadList();
    } catch (caught) {
      setError(messageForEstimateApiError(caught));
    } finally {
      setStatusPending(false);
      setSendPending(false);
    }
  }

  return (
    <section className="app-panel">
      <div className="estimates-tab-toolbar">
        <p className="app-muted">
          Cotizaciones y presupuestos de esta orden de trabajo.
        </p>
        {canCreateEstimate ? (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
          >
            Nueva cotización
          </button>
        ) : null}
      </div>

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

      {workOrderClosed ? (
        <p className="app-alert app-alert--info" role="status">
          Esta orden está cerrada. Las cotizaciones son de solo lectura.
        </p>
      ) : null}

      <div className="estimates-panels">
        <aside className="app-panel estimates-list-panel" aria-label="Lista de cotizaciones">
          {listLoading ? (
            <p className="app-muted" role="status">
              Cargando cotizaciones…
            </p>
          ) : summaries.length === 0 ? (
            <p className="app-empty-inline">
              Aún no hay cotizaciones para esta orden.
            </p>
          ) : (
            <ul className="estimates-list">
              {summaries.map((estimate) => (
                <li key={estimate.id}>
                  <button
                    type="button"
                    className={
                      selectedId === estimate.id
                        ? 'estimates-list-item is-selected'
                        : 'estimates-list-item'
                    }
                    aria-current={selectedId === estimate.id ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(estimate.id);
                      setError(null);
                      setSuccess(null);
                    }}
                  >
                    <span className="estimates-list-item-title">
                      Cotización #{estimate.number}
                    </span>
                    <span
                      className={`status-badge ${estimateStatusBadgeClass(estimate.status)}`}
                    >
                      {estimateStatusLabel(estimate.status)}
                    </span>
                    <span className="estimates-list-item-meta">
                      {formatMoney(estimate.total, estimate.currency)}
                      {' · '}
                      {formatCompactDate(estimate.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="app-panel estimates-detail-panel">
          {selectedId === null ? (
            <p className="app-muted">Selecciona una cotización para ver el detalle.</p>
          ) : detailLoading && detail === null ? (
            <p className="app-muted" role="status">
              Cargando cotización…
            </p>
          ) : detail === null ? (
            <p className="app-muted">No se pudo cargar la cotización.</p>
          ) : (
            <EstimateDetailPanel
              detail={detail}
              canMutateEstimate={canMutateEstimate}
              canManageStatus={canManageStatus}
              canManagePublicAccess={canManagePublicAccess}
              issuedPublicLink={
                detail !== null ? (issuedLinks[detail.id] ?? null) : null
              }
              publicAccessIssuePending={publicAccessIssuePending}
              publicAccessRevokePending={publicAccessRevokePending}
              statusRefreshPending={statusRefreshPending}
              onRefreshStatus={() =>
                void refreshEstimateDetail({ announceCustomerDecision: true })
              }
              onIssuePublicLink={handleIssuePublicLink}
              onRevokePublicLink={handleRevokePublicLink}
              onPublicAccessFeedback={(message) => setSuccess(message)}
              onEditMetadata={() => setEditMetaOpen(true)}
              onAddItem={() => setAddItemOpen(true)}
              onEditItem={setEditItem}
              onDeleteItem={setDeleteItemTarget}
              onSend={() => setSendOpen(true)}
              onStatusAction={setStatusConfirm}
            />
          )}
        </div>
      </div>

      <CreateEstimateModal
        open={createOpen}
        pending={createPending}
        onClose={() => {
          if (!createPending) {
            setCreateOpen(false);
          }
        }}
        onSubmit={async (input) => {
          setCreatePending(true);
          setError(null);
          try {
            const created = await createEstimateRequest(workOrderId, input);
            setCreateOpen(false);
            setSelectedId(created.id);
            setDetail(created);
            setSuccess('Cotización creada correctamente.');
            await loadList();
          } catch (caught) {
            setError(messageForEstimateApiError(caught));
          } finally {
            setCreatePending(false);
          }
        }}
      />

      {detail !== null ? (
        <>
          <EditEstimateMetadataModal
            open={editMetaOpen}
            pending={editMetaPending}
            detail={detail}
            onClose={() => {
              if (!editMetaPending) {
                setEditMetaOpen(false);
              }
            }}
            onSubmit={async (input) => {
              setEditMetaPending(true);
              setError(null);
              try {
                const updated = await updateEstimateRequest(detail.id, input);
                setDetail(updated);
                setEditMetaOpen(false);
                setSuccess('Cambios guardados.');
                await loadList();
              } catch (caught) {
                setError(messageForEstimateApiError(caught));
              } finally {
                setEditMetaPending(false);
              }
            }}
          />

          <EstimateItemModal
            open={addItemOpen}
            pending={addItemPending}
            title="Agregar concepto"
            submitLabel="Agregar"
            onClose={() => {
              if (!addItemPending) {
                setAddItemOpen(false);
              }
            }}
            onSubmit={async (input) => {
              setAddItemPending(true);
              setError(null);
              try {
                await addEstimateItemRequest(detail.id, input);
                setAddItemOpen(false);
                setSuccess('Concepto agregado.');
                await refreshAfterMutation(detail.id);
              } catch (caught) {
                setError(messageForEstimateApiError(caught));
              } finally {
                setAddItemPending(false);
              }
            }}
          />

          <EstimateItemModal
            open={editItem !== null}
            pending={editItemPending}
            title="Editar concepto"
            submitLabel="Guardar"
            initialItem={editItem}
            onClose={() => {
              if (!editItemPending) {
                setEditItem(null);
              }
            }}
            onSubmit={async (input) => {
              if (editItem === null) {
                return;
              }
              setEditItemPending(true);
              setError(null);
              try {
                await updateEstimateItemRequest(detail.id, editItem.id, input);
                setEditItem(null);
                setSuccess('Cambios guardados.');
                await refreshAfterMutation(detail.id);
              } catch (caught) {
                setError(messageForEstimateApiError(caught));
              } finally {
                setEditItemPending(false);
              }
            }}
          />

          <DeleteEstimateItemModal
            open={deleteItemTarget !== null}
            pending={deleteItemPending}
            onClose={() => {
              if (!deleteItemPending) {
                setDeleteItemTarget(null);
              }
            }}
            onConfirm={async () => {
              if (deleteItemTarget === null) {
                return;
              }
              setDeleteItemPending(true);
              setError(null);
              try {
                await deleteEstimateItemRequest(
                  detail.id,
                  deleteItemTarget.id,
                );
                setDeleteItemTarget(null);
                setSuccess('Concepto eliminado.');
                await refreshAfterMutation(detail.id);
              } catch (caught) {
                setError(messageForEstimateApiError(caught));
              } finally {
                setDeleteItemPending(false);
              }
            }}
          />

          <SendEstimateModal
            open={sendOpen}
            pending={sendPending || statusPending}
            onClose={() => {
              if (!sendPending && !statusPending) {
                setSendOpen(false);
              }
            }}
            onConfirm={async () => {
              setSendPending(true);
              await handleStatusChange('SENT', 'Cotización enviada.');
            }}
          />

          <EstimateStatusConfirmModal
            target={statusConfirm}
            pending={statusPending}
            onClose={() => {
              if (!statusPending) {
                setStatusConfirm(null);
              }
            }}
            onConfirm={async () => {
              if (statusConfirm === null) {
                return;
              }
              const messages: Record<
                'APPROVED' | 'REJECTED' | 'CANCELLED',
                string
              > = {
                APPROVED: 'Cotización aprobada.',
                REJECTED: 'Cotización rechazada.',
                CANCELLED: 'Cotización cancelada.',
              };
              await handleStatusChange(statusConfirm, messages[statusConfirm]);
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function EstimateDetailPanel({
  detail,
  canMutateEstimate,
  canManageStatus,
  canManagePublicAccess,
  issuedPublicLink,
  publicAccessIssuePending,
  publicAccessRevokePending,
  statusRefreshPending,
  onRefreshStatus,
  onIssuePublicLink,
  onRevokePublicLink,
  onPublicAccessFeedback,
  onEditMetadata,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onSend,
  onStatusAction,
}: {
  detail: EstimateDetail;
  canMutateEstimate: boolean;
  canManageStatus: boolean;
  canManagePublicAccess: boolean;
  issuedPublicLink: EstimatePublicAccessMemory | null;
  publicAccessIssuePending: boolean;
  publicAccessRevokePending: boolean;
  statusRefreshPending: boolean;
  onRefreshStatus: () => void;
  onIssuePublicLink: () => Promise<{ publicUrl: string; expiresAt: string }>;
  onRevokePublicLink: () => Promise<void>;
  onPublicAccessFeedback: (message: string) => void;
  onEditMetadata: () => void;
  onAddItem: () => void;
  onEditItem: (item: EstimateItem) => void;
  onDeleteItem: (item: EstimateItem) => void;
  onSend: () => void;
  onStatusAction: (status: 'APPROVED' | 'REJECTED' | 'CANCELLED') => void;
}) {
  const terminalTs = estimateTerminalTimestampLabel(detail.status, detail);
  const showSentNotice = detail.status === 'SENT';
  const showTerminalNotice = isEstimateTerminal(detail.status);

  return (
    <div className="estimate-detail">
      <header className="estimate-detail-header">
        <div>
          <h3>Cotización #{detail.number}</h3>
          <p className="estimate-detail-meta">
            <span
              className={`status-badge ${estimateStatusBadgeClass(detail.status)}`}
            >
              {estimateStatusLabel(detail.status)}
            </span>
            <span>{formatMoney(detail.total, detail.currency)}</span>
            <span>Creada {formatDisplayDate(detail.createdAt)}</span>
            {terminalTs !== null ? (
              <span>
                {estimateStatusLabel(detail.status)}{' '}
                {formatDisplayDate(terminalTs)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="estimate-detail-actions">
          {canMutateEstimate ? (
            <>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={onEditMetadata}
              >
                Editar cotización
              </button>
              {canManageStatus ? (
                <>
                  <button
                    type="button"
                    className="app-button app-button--primary"
                    onClick={onSend}
                  >
                    Enviar cotización
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--danger"
                    onClick={() => onStatusAction('CANCELLED')}
                  >
                    Cancelar cotización
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          {!canMutateEstimate &&
          canManageStatus &&
          detail.status === 'SENT' ? (
            <>
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={() => onStatusAction('APPROVED')}
              >
                Aprobar
              </button>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => onStatusAction('REJECTED')}
              >
                Rechazar
              </button>
              <button
                type="button"
                className="app-button app-button--danger"
                onClick={() => onStatusAction('CANCELLED')}
              >
                Cancelar cotización
              </button>
            </>
          ) : null}
        </div>
      </header>

      {showSentNotice ? (
        <p className="app-alert app-alert--info" role="status">
          Cotización enviada. Los conceptos ya no pueden modificarse.
        </p>
      ) : null}

      {detail.status === 'SENT' ? (
        <div className="estimate-sent-status-row">
          <button
            type="button"
            className="app-button app-button--secondary"
            disabled={statusRefreshPending}
            onClick={onRefreshStatus}
          >
            {statusRefreshPending ? 'Actualizando…' : 'Actualizar estado'}
          </button>
        </div>
      ) : null}

      {canManagePublicAccess ? (
        <EstimatePublicAccessSection
          issuedLink={issuedPublicLink}
          issuePending={publicAccessIssuePending}
          revokePending={publicAccessRevokePending}
          onIssueLink={onIssuePublicLink}
          onRevokeLink={onRevokePublicLink}
          onLocalFeedback={onPublicAccessFeedback}
        />
      ) : null}

      {showTerminalNotice ? (
        <p className="app-alert app-alert--info" role="status">
          Esta cotización está en estado final y ya no puede modificarse.
        </p>
      ) : null}

      <div className="estimate-metadata-grid">
        <div className="estimate-metadata-block">
          <h4>Moneda</h4>
          <p>{detail.currency}</p>
        </div>
        <div className="estimate-metadata-block">
          <h4>Válida hasta</h4>
          <p>
            {detail.validUntil !== null
              ? formatCompactDate(detail.validUntil)
              : 'Sin fecha de vencimiento'}
          </p>
        </div>
        {detail.terms !== null && detail.terms !== '' ? (
          <div className="estimate-metadata-block app-field--full">
            <h4>Términos</h4>
            <p>{detail.terms}</p>
          </div>
        ) : null}
        {detail.notes !== null && detail.notes !== '' ? (
          <div className="estimate-metadata-block app-field--full">
            <h4>Notas internas</h4>
            <p>{detail.notes}</p>
          </div>
        ) : null}
      </div>

      <div className="estimate-items-header">
        <h4>Conceptos</h4>
        {canMutateEstimate ? (
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={onAddItem}
          >
            Agregar concepto
          </button>
        ) : null}
      </div>

      {detail.items.length === 0 ? (
        <p className="app-muted">Esta cotización aún no tiene conceptos.</p>
      ) : (
        <ul className="estimate-items">
          {detail.items.map((item) => (
            <li key={item.id}>
              <article className="estimate-item-card">
                <div className="estimate-item-card-header">
                  <h5>{item.description}</h5>
                  <span className="estimate-item-type">
                    {estimateItemTypeLabel(item.type)}
                  </span>
                </div>
                <div className="estimate-item-lines">
                  <div className="estimate-item-line">
                    <span>Cantidad</span>
                    <strong>{formatQuantity(item.quantity)}</strong>
                  </div>
                  <div className="estimate-item-line">
                    <span>Precio unitario</span>
                    <strong>
                      {formatMoney(item.unitPrice, detail.currency)}
                    </strong>
                  </div>
                  {!isZeroMoney(item.discountAmount) ||
                  formatPercent(item.discountPercent) !== '' ? (
                    <div className="estimate-item-line">
                      <span>
                        Descuento
                        {formatPercent(item.discountPercent) !== ''
                          ? ` (${formatPercent(item.discountPercent)})`
                          : ''}
                      </span>
                      <strong>
                        {formatMoney(item.discountAmount, detail.currency)}
                      </strong>
                    </div>
                  ) : null}
                  {!isZeroMoney(item.taxAmount) ||
                  formatPercent(item.taxPercent) !== '' ? (
                    <div className="estimate-item-line">
                      <span>
                        Impuesto
                        {formatPercent(item.taxPercent) !== ''
                          ? ` (${formatPercent(item.taxPercent)})`
                          : ''}
                      </span>
                      <strong>
                        {formatMoney(item.taxAmount, detail.currency)}
                      </strong>
                    </div>
                  ) : null}
                  <div className="estimate-item-line">
                    <span>Total línea</span>
                    <strong>{formatMoney(item.total, detail.currency)}</strong>
                  </div>
                </div>
                {canMutateEstimate ? (
                  <div className="estimate-item-actions">
                    <button
                      type="button"
                      className="app-button app-button--ghost app-button--compact"
                      onClick={() => onEditItem(item)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="app-button app-button--danger app-button--compact"
                      onClick={() => onDeleteItem(item)}
                    >
                      Eliminar
                    </button>
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}

      <EstimateTotalsSummary detail={detail} />
    </div>
  );
}

function EstimateTotalsSummary({ detail }: { detail: EstimateDetail }) {
  return (
    <div className="estimate-totals-card" aria-label="Totales de la cotización">
      <div className="estimate-totals-row">
        <span>Subtotal</span>
        <span>{formatMoney(detail.subtotal, detail.currency)}</span>
      </div>
      <div className="estimate-totals-row">
        <span>Descuentos</span>
        <span>{formatMoney(detail.discountTotal, detail.currency)}</span>
      </div>
      <div className="estimate-totals-row">
        <span>Impuestos</span>
        <span>{formatMoney(detail.taxTotal, detail.currency)}</span>
      </div>
      <div className="estimate-totals-row estimate-totals-row--total">
        <span>TOTAL</span>
        <span>{formatMoney(detail.total, detail.currency)}</span>
      </div>
    </div>
  );
}

function CreateEstimateModal({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    currency: string;
    notes?: string | null;
    terms?: string | null;
    validUntil?: string | null;
  }) => Promise<void>;
}) {
  const [currency, setCurrency] = useState('CRC');
  const [validUntil, setValidUntil] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrency('CRC');
      setValidUntil('');
      setTerms('');
      setNotes('');
      setFieldError(null);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const currencyError = validateCurrencyCode(currency);
    if (currencyError !== null) {
      setFieldError(currencyError);
      return;
    }
    setFieldError(null);
    await onSubmit({
      currency: currency.trim().toUpperCase(),
      terms: terms.trim() === '' ? null : terms.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      validUntil: fromDateInputValue(validUntil),
    });
  }

  return (
    <Modal open={open} title="Nueva cotización" onClose={onClose}>
      <form className="estimate-form-grid" onSubmit={(event) => void handleSubmit(event)}>
        <div className="app-field">
          <label htmlFor="estimate-create-currency">Moneda</label>
          <input
            id="estimate-create-currency"
            className="app-input"
            value={currency}
            maxLength={3}
            autoComplete="off"
            disabled={pending}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </div>
        <div className="app-field">
          <label htmlFor="estimate-create-valid-until">Válida hasta (opcional)</label>
          <input
            id="estimate-create-valid-until"
            className="app-input"
            type="date"
            value={validUntil}
            disabled={pending}
            onChange={(event) => setValidUntil(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="estimate-create-terms">Términos (opcional)</label>
          <textarea
            id="estimate-create-terms"
            className="app-input"
            rows={3}
            value={terms}
            disabled={pending}
            onChange={(event) => setTerms(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="estimate-create-notes">Notas internas (opcional)</label>
          <textarea
            id="estimate-create-notes"
            className="app-input"
            rows={3}
            value={notes}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {fieldError !== null ? (
          <p className="app-alert app-alert--error app-field--full" role="alert">
            {fieldError}
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
            type="submit"
            className="app-button app-button--primary"
            disabled={pending}
          >
            {pending ? 'Creando…' : 'Crear cotización'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function EditEstimateMetadataModal({
  open,
  pending,
  detail,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  detail: EstimateDetail;
  onClose: () => void;
  onSubmit: (input: {
    currency?: string;
    notes?: string | null;
    terms?: string | null;
    validUntil?: string | null;
  }) => Promise<void>;
}) {
  const [currency, setCurrency] = useState(detail.currency);
  const [validUntil, setValidUntil] = useState(
    toDateInputValue(detail.validUntil),
  );
  const [terms, setTerms] = useState(detail.terms ?? '');
  const [notes, setNotes] = useState(detail.notes ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrency(detail.currency);
      setValidUntil(toDateInputValue(detail.validUntil));
      setTerms(detail.terms ?? '');
      setNotes(detail.notes ?? '');
      setFieldError(null);
    }
  }, [open, detail]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const currencyError = validateCurrencyCode(currency);
    if (currencyError !== null) {
      setFieldError(currencyError);
      return;
    }
    setFieldError(null);
    await onSubmit({
      currency: currency.trim().toUpperCase(),
      terms: terms.trim() === '' ? null : terms.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      validUntil: fromDateInputValue(validUntil),
    });
  }

  return (
    <Modal open={open} title="Editar cotización" onClose={onClose}>
      <form className="estimate-form-grid" onSubmit={(event) => void handleSubmit(event)}>
        <div className="app-field">
          <label htmlFor="estimate-edit-currency">Moneda</label>
          <input
            id="estimate-edit-currency"
            className="app-input"
            value={currency}
            maxLength={3}
            disabled={pending}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </div>
        <div className="app-field">
          <label htmlFor="estimate-edit-valid-until">Válida hasta (opcional)</label>
          <input
            id="estimate-edit-valid-until"
            className="app-input"
            type="date"
            value={validUntil}
            disabled={pending}
            onChange={(event) => setValidUntil(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="estimate-edit-terms">Términos (opcional)</label>
          <textarea
            id="estimate-edit-terms"
            className="app-input"
            rows={3}
            value={terms}
            disabled={pending}
            onChange={(event) => setTerms(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="estimate-edit-notes">Notas internas (opcional)</label>
          <textarea
            id="estimate-edit-notes"
            className="app-input"
            rows={3}
            value={notes}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {fieldError !== null ? (
          <p className="app-alert app-alert--error app-field--full" role="alert">
            {fieldError}
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

const DEFAULT_ITEM_FORM = {
  type: 'PART' as EstimateItemType,
  description: '',
  quantity: '1.000',
  unitPrice: '',
  discountPercent: '0.00',
  taxPercent: '13.00',
};

function EstimateItemModal({
  open,
  pending,
  title,
  submitLabel,
  initialItem = null,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  submitLabel: string;
  initialItem?: EstimateItem | null;
  onClose: () => void;
  onSubmit: (input: {
    type: EstimateItemType;
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
    taxPercent: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState(DEFAULT_ITEM_FORM);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (initialItem !== null) {
      setForm({
        type: initialItem.type,
        description: initialItem.description,
        quantity: initialItem.quantity,
        unitPrice: initialItem.unitPrice,
        discountPercent: initialItem.discountPercent,
        taxPercent: initialItem.taxPercent,
      });
    } else {
      setForm(DEFAULT_ITEM_FORM);
    }
    setFieldError(null);
  }, [open, initialItem]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateEstimateItemFields(form);
    if (validationError !== null) {
      setFieldError(validationError);
      return;
    }
    setFieldError(null);
    await onSubmit({
      type: form.type,
      description: form.description.trim(),
      quantity: form.quantity.trim(),
      unitPrice: form.unitPrice.trim(),
      discountPercent: form.discountPercent.trim(),
      taxPercent: form.taxPercent.trim(),
    });
  }

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form
        className="estimate-form-grid estimate-form-grid--paired"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="app-field app-field--full">
          <label htmlFor="estimate-item-type">Tipo</label>
          <select
            id="estimate-item-type"
            className="app-input"
            value={form.type}
            disabled={pending}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type: event.target.value as EstimateItemType,
              }))
            }
          >
            {ESTIMATE_ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {estimateItemTypeLabel(type)}
              </option>
            ))}
          </select>
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="estimate-item-description">Descripción</label>
          <input
            id="estimate-item-description"
            className="app-input"
            value={form.description}
            maxLength={500}
            disabled={pending}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </div>
        <div className="app-field">
          <label htmlFor="estimate-item-quantity">Cantidad</label>
          <input
            id="estimate-item-quantity"
            className="app-input"
            inputMode="decimal"
            value={form.quantity}
            disabled={pending}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quantity: event.target.value,
              }))
            }
          />
        </div>
        <div className="app-field">
          <label htmlFor="estimate-item-unit-price">Precio unitario</label>
          <input
            id="estimate-item-unit-price"
            className="app-input"
            inputMode="decimal"
            value={form.unitPrice}
            disabled={pending}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                unitPrice: event.target.value,
              }))
            }
          />
        </div>
        <div className="app-field">
          <label htmlFor="estimate-item-discount">Descuento %</label>
          <input
            id="estimate-item-discount"
            className="app-input"
            inputMode="decimal"
            value={form.discountPercent}
            disabled={pending}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                discountPercent: event.target.value,
              }))
            }
          />
        </div>
        <div className="app-field">
          <label htmlFor="estimate-item-tax">Impuesto %</label>
          <input
            id="estimate-item-tax"
            className="app-input"
            inputMode="decimal"
            value={form.taxPercent}
            disabled={pending}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                taxPercent: event.target.value,
              }))
            }
          />
        </div>
        {fieldError !== null ? (
          <p className="app-alert app-alert--error app-field--full" role="alert">
            {fieldError}
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
            type="submit"
            className="app-button app-button--primary"
            disabled={pending}
          >
            {pending ? 'Guardando…' : submitLabel}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function DeleteEstimateItemModal({
  open,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal open={open} title="Eliminar concepto" onClose={onClose}>
      <p>Este concepto se eliminará de la cotización.</p>
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
          {pending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function SendEstimateModal({
  open,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal open={open} title="Enviar cotización" onClose={onClose}>
      <p>
        Después de enviarla, los conceptos ya no podrán modificarse.
      </p>
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
          {pending ? 'Enviando…' : 'Enviar'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function EstimateStatusConfirmModal({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: 'APPROVED' | 'REJECTED' | 'CANCELLED' | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const copy = useMemo(() => {
    switch (target) {
      case 'APPROVED':
        return {
          title: 'Aprobar cotización',
          body: 'La cotización quedará marcada como aprobada.',
          confirm: 'Aprobar',
          danger: false,
        };
      case 'REJECTED':
        return {
          title: 'Rechazar cotización',
          body: 'La cotización quedará marcada como rechazada.',
          confirm: 'Rechazar',
          danger: false,
        };
      case 'CANCELLED':
        return {
          title: 'Cancelar cotización',
          body: 'La cotización quedará cancelada y no podrá modificarse.',
          confirm: 'Cancelar cotización',
          danger: true,
        };
      default:
        return null;
    }
  }, [target]);

  if (copy === null) {
    return null;
  }

  return (
    <Modal open={target !== null} title={copy.title} onClose={onClose}>
      <p>{copy.body}</p>
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          disabled={pending}
          onClick={onClose}
        >
          Volver
        </button>
        <button
          type="button"
          className={
            copy.danger
              ? 'app-button app-button--danger'
              : 'app-button app-button--primary'
          }
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          {pending ? 'Procesando…' : copy.confirm}
        </button>
      </ModalFooter>
    </Modal>
  );
}
