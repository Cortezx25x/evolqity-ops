import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { TenantNotReadyError } from '../../api/api-client';
import {
  addInspectionItemRequest,
  completeInspectionRequest,
  createInspectionRequest,
  deleteInspectionItemRequest,
  getInspectionRequest,
  listInspectionsRequest,
  updateInspectionItemRequest,
  updateInspectionRequest,
  type InspectionDetail,
  type InspectionItem,
  type InspectionItemCondition,
  type InspectionSummary,
} from '../../api/inspections.api';
import { useOrganization } from '../../contexts/OrganizationContext';
import { Modal, ModalFooter } from '../Modal';
import { formatDisplayDate } from '../../lib/dates';
import {
  inspectionHasIncompleteItems,
  inspectionStatusLabel,
  messageForInspectionApiError,
} from '../../lib/inspections';
import {
  uploadInspectionItemMediaRequest,
  listInspectionItemMediaRequest,
} from '../../api/media.api';
import type { MediaItem } from '../../api/media.api';
import { messageForMediaApiError } from '../../lib/media';
import { MediaGallerySection } from '../media/MediaGallerySection';
import { InspectionConditionSelector } from './InspectionConditionSelector';
import './inspections.css';
import '../media/media.css';

export interface WorkOrderInspectionsTabProps {
  workOrderId: string;
  workOrderClosed: boolean;
}

export function WorkOrderInspectionsTab({
  workOrderId,
  workOrderClosed,
}: WorkOrderInspectionsTabProps) {
  const { isTenantReady } = useOrganization();
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const [summaries, setSummaries] = useState<InspectionSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [completeHighlight, setCompleteHighlight] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editInspectionOpen, setEditInspectionOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<InspectionItem | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<InspectionItem | null>(
    null,
  );
  const [completeOpen, setCompleteOpen] = useState(false);

  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [editInspectionPending, setEditInspectionPending] = useState(false);
  const [addItemPending, setAddItemPending] = useState(false);
  const [editItemPending, setEditItemPending] = useState(false);
  const [deleteItemPending, setDeleteItemPending] = useState(false);
  const [completePending, setCompletePending] = useState(false);
  const [itemMedia, setItemMedia] = useState<Record<string, MediaItem[]>>({});
  const [itemMediaError, setItemMediaError] = useState<string | null>(null);

  const canMutateWorkOrder = !workOrderClosed;
  const canMutateInspection =
    canMutateWorkOrder && detail !== null && detail.status === 'DRAFT';
  const isReadOnlyInspection =
    detail !== null && detail.status === 'COMPLETED';

  const loadList = useCallback(async () => {
    if (!isTenantReady) {
      return;
    }

    const requestId = ++listRequestId.current;
    setListLoading(true);
    setError(null);
    try {
      const result = await listInspectionsRequest(workOrderId, {
        limit: 100,
        page: 1,
      });
      if (requestId !== listRequestId.current) {
        return;
      }
      setSummaries(result.data);
      setSelectedId((current) =>
        current !== null && !result.data.some((row) => row.id === current)
          ? null
          : current,
      );
    } catch (caught) {
      if (requestId !== listRequestId.current) {
        return;
      }
      if (caught instanceof TenantNotReadyError) {
        return;
      }
      setError(messageForInspectionApiError(caught));
    } finally {
      if (requestId === listRequestId.current) {
        setListLoading(false);
      }
    }
  }, [isTenantReady, workOrderId]);

  const loadDetail = useCallback(
    async (inspectionId: string) => {
      if (!isTenantReady) {
        return;
      }

      const requestId = ++detailRequestId.current;
      setDetailLoading(true);
      setError(null);
      try {
        const next = await getInspectionRequest(inspectionId);
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
        setError(messageForInspectionApiError(caught));
      } finally {
        if (requestId === detailRequestId.current) {
          setDetailLoading(false);
        }
      }
    },
    [isTenantReady],
  );

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

  const refreshAfterMutation = useCallback(
    async (inspectionId: string) => {
      await Promise.all([loadList(), loadDetail(inspectionId)]);
    },
    [loadList, loadDetail],
  );

  const loadItemMediaForInspection = useCallback(
    async (inspection: InspectionDetail) => {
      if (!isTenantReady) {
        return;
      }

      setItemMediaError(null);
      try {
        const entries = await Promise.all(
          inspection.items.map(async (item) => {
            const list = await listInspectionItemMediaRequest(
              inspection.id,
              item.id,
            );
            return [item.id, list] as const;
          }),
        );
        setItemMedia(Object.fromEntries(entries));
      } catch (caught) {
        if (!(caught instanceof TenantNotReadyError)) {
          setItemMediaError(messageForMediaApiError(caught));
        }
      }
    },
    [isTenantReady],
  );

  useEffect(() => {
    if (detail === null || !isTenantReady) {
      setItemMedia({});
      return;
    }
    void loadItemMediaForInspection(detail);
  }, [detail, isTenantReady, loadItemMediaForInspection]);

  async function handleConditionSelect(
    item: InspectionItem,
    condition: InspectionItemCondition,
  ) {
    if (detail === null || !canMutateInspection || item.condition === condition) {
      return;
    }

    setPendingItemId(item.id);
    setError(null);
    try {
      const updated = await updateInspectionItemRequest(
        detail.id,
        item.id,
        { condition },
      );
      setDetail((current) =>
        current === null
          ? current
          : {
              ...current,
              items: current.items.map((row) =>
                row.id === updated.id ? updated : row,
              ),
            },
      );
      setCompleteHighlight(false);
    } catch (caught) {
      setError(messageForInspectionApiError(caught));
    } finally {
      setPendingItemId(null);
    }
  }

  function tryOpenComplete() {
    if (detail === null || !canMutateInspection) {
      return;
    }

    if (inspectionHasIncompleteItems(detail.items)) {
      setCompleteHighlight(true);
      setError(
        'Todos los puntos deben tener una condición antes de completar la inspección.',
      );
      return;
    }

    setError(null);
    setCompleteOpen(true);
  }

  const incompleteItems = useMemo(
    () =>
      detail === null
        ? []
        : detail.items.filter((item) => item.condition === null),
    [detail],
  );

  return (
    <section className="inspections-layout" aria-labelledby="wo-inspections-heading">
      <div className="inspections-layout-header">
        <h2 id="wo-inspections-heading">Inspecciones</h2>
        {canMutateWorkOrder ? (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={() => {
              setSuccess(null);
              setError(null);
              setCreateOpen(true);
            }}
          >
            Nueva inspección
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
          Esta orden está cerrada. Las inspecciones son de solo lectura.
        </p>
      ) : null}

      <div className="inspections-panels">
        <aside className="app-panel inspections-list-panel" aria-label="Lista de inspecciones">
          {listLoading ? (
            <p className="app-muted" role="status">
              Cargando inspecciones…
            </p>
          ) : summaries.length === 0 ? (
            <p className="app-empty-inline">
              Aún no hay inspecciones para esta orden.
            </p>
          ) : (
            <ul className="inspections-list">
              {summaries.map((inspection) => (
                <li key={inspection.id}>
                  <button
                    type="button"
                    className={
                      selectedId === inspection.id
                        ? 'inspections-list-item is-selected'
                        : 'inspections-list-item'
                    }
                    aria-current={selectedId === inspection.id ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(inspection.id);
                      setCompleteHighlight(false);
                      setError(null);
                    }}
                  >
                    <span className="inspections-list-item-title">
                      {inspection.title}
                    </span>
                    <span
                      className={
                        inspection.status === 'COMPLETED'
                          ? 'status-badge status-badge--success'
                          : 'status-badge status-badge--muted'
                      }
                    >
                      {inspectionStatusLabel(inspection.status)}
                    </span>
                    <span className="inspections-list-item-meta">
                      {formatDisplayDate(inspection.createdAt)}
                      {inspection.itemCount > 0
                        ? ` · ${inspection.itemCount} punto${inspection.itemCount === 1 ? '' : 's'}`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="app-panel inspections-detail-panel">
          {selectedId === null ? (
            <p className="app-muted">Selecciona una inspección para ver el detalle.</p>
          ) : detailLoading && detail === null ? (
            <p className="app-muted" role="status">
              Cargando inspección…
            </p>
          ) : detail === null ? (
            <p className="app-muted">No se pudo cargar la inspección.</p>
          ) : (
            <InspectionDetailPanel
              detail={detail}
              canMutateInspection={canMutateInspection}
              isReadOnlyInspection={isReadOnlyInspection}
              completeHighlight={completeHighlight}
              incompleteCount={incompleteItems.length}
              pendingItemId={pendingItemId}
              itemMedia={itemMedia}
              itemMediaError={itemMediaError}
              onItemMediaUpdated={(itemId, updated) => {
                setItemMedia((current) => ({
                  ...current,
                  [itemId]: (current[itemId] ?? []).map((row) =>
                    row.id === updated.id ? updated : row,
                  ),
                }));
              }}
              onItemMediaRemoved={(itemId, mediaId) => {
                setItemMedia((current) => ({
                  ...current,
                  [itemId]: (current[itemId] ?? []).filter(
                    (row) => row.id !== mediaId,
                  ),
                }));
              }}
              onItemMediaAdded={(itemId, created) => {
                setItemMedia((current) => ({
                  ...current,
                  [itemId]: [...(current[itemId] ?? []), created],
                }));
              }}
              onEditInspection={() => setEditInspectionOpen(true)}
              onAddItem={() => setAddItemOpen(true)}
              onEditItem={setEditItem}
              onDeleteItem={setDeleteItemTarget}
              onConditionSelect={handleConditionSelect}
              onComplete={tryOpenComplete}
            />
          )}
        </div>
      </div>

      <CreateInspectionModal
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
            const created = await createInspectionRequest(workOrderId, input);
            setCreateOpen(false);
            setSuccess('Inspección creada correctamente.');
            await loadList();
            setSelectedId(created.id);
            setDetail(created);
          } catch (caught) {
            setError(messageForInspectionApiError(caught));
          } finally {
            setCreatePending(false);
          }
        }}
      />

      {detail !== null ? (
        <>
          <EditInspectionModal
            open={editInspectionOpen}
            pending={editInspectionPending}
            inspection={detail}
            onClose={() => {
              if (!editInspectionPending) {
                setEditInspectionOpen(false);
              }
            }}
            onSubmit={async (input) => {
              setEditInspectionPending(true);
              setError(null);
              try {
                const updated = await updateInspectionRequest(detail.id, input);
                setEditInspectionOpen(false);
                setDetail(updated);
                setSuccess('Cambios guardados.');
                await loadList();
              } catch (caught) {
                setError(messageForInspectionApiError(caught));
              } finally {
                setEditInspectionPending(false);
              }
            }}
          />

          <AddItemModal
            open={addItemOpen}
            pending={addItemPending}
            onClose={() => {
              if (!addItemPending) {
                setAddItemOpen(false);
              }
            }}
            onSubmit={async (input) => {
              setAddItemPending(true);
              setError(null);
              try {
                await addInspectionItemRequest(detail.id, input);
                setAddItemOpen(false);
                setSuccess('Punto agregado.');
                await refreshAfterMutation(detail.id);
              } catch (caught) {
                setError(messageForInspectionApiError(caught));
              } finally {
                setAddItemPending(false);
              }
            }}
          />

          <EditItemModal
            open={editItem !== null}
            pending={editItemPending}
            item={editItem}
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
                const updated = await updateInspectionItemRequest(
                  detail.id,
                  editItem.id,
                  input,
                );
                setEditItem(null);
                setDetail((current) =>
                  current === null
                    ? null
                    : {
                        ...current,
                        items: current.items.map((row) =>
                          row.id === updated.id ? updated : row,
                        ),
                      },
                );
                setSuccess('Cambios guardados.');
              } catch (caught) {
                setError(messageForInspectionApiError(caught));
              } finally {
                setEditItemPending(false);
              }
            }}
          />

          <DeleteItemModal
            open={deleteItemTarget !== null}
            pending={deleteItemPending}
            item={deleteItemTarget}
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
                await deleteInspectionItemRequest(detail.id, deleteItemTarget.id);
                setDeleteItemTarget(null);
                setSuccess('Punto eliminado.');
                await refreshAfterMutation(detail.id);
              } catch (caught) {
                setError(messageForInspectionApiError(caught));
              } finally {
                setDeleteItemPending(false);
              }
            }}
          />

          <CompleteInspectionModal
            open={completeOpen}
            pending={completePending}
            onClose={() => {
              if (!completePending) {
                setCompleteOpen(false);
              }
            }}
            onConfirm={async () => {
              setCompletePending(true);
              setError(null);
              try {
                const updated = await completeInspectionRequest(detail.id);
                setCompleteOpen(false);
                setDetail(updated);
                setCompleteHighlight(false);
                setSuccess('Inspección completada.');
                await loadList();
              } catch (caught) {
                setError(messageForInspectionApiError(caught));
              } finally {
                setCompletePending(false);
              }
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function InspectionDetailPanel({
  detail,
  canMutateInspection,
  isReadOnlyInspection,
  completeHighlight,
  incompleteCount,
  pendingItemId,
  itemMedia,
  itemMediaError,
  onItemMediaUpdated,
  onItemMediaRemoved,
  onItemMediaAdded,
  onEditInspection,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onConditionSelect,
  onComplete,
}: {
  detail: InspectionDetail;
  canMutateInspection: boolean;
  isReadOnlyInspection: boolean;
  completeHighlight: boolean;
  incompleteCount: number;
  pendingItemId: string | null;
  itemMedia: Record<string, MediaItem[]>;
  itemMediaError: string | null;
  onItemMediaUpdated: (itemId: string, media: MediaItem) => void;
  onItemMediaRemoved: (itemId: string, mediaId: string) => void;
  onItemMediaAdded: (itemId: string, media: MediaItem) => void;
  onEditInspection: () => void;
  onAddItem: () => void;
  onEditItem: (item: InspectionItem) => void;
  onDeleteItem: (item: InspectionItem) => void;
  onConditionSelect: (
    item: InspectionItem,
    condition: InspectionItemCondition,
  ) => void | Promise<void>;
  onComplete: () => void;
}) {
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  return (
    <div className="inspection-detail">
      <header className="inspection-detail-header">
        <div>
          <h3>{detail.title}</h3>
          <p className="inspection-detail-meta">
            <span
              className={
                detail.status === 'COMPLETED'
                  ? 'status-badge status-badge--success'
                  : 'status-badge status-badge--muted'
              }
            >
              {inspectionStatusLabel(detail.status)}
            </span>
            <span>Creada {formatDisplayDate(detail.createdAt)}</span>
            {detail.completedAt !== null ? (
              <span>Completada {formatDisplayDate(detail.completedAt)}</span>
            ) : null}
          </p>
        </div>
        {canMutateInspection ? (
          <div className="inspection-detail-actions">
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={onEditInspection}
            >
              Editar inspección
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={onComplete}
            >
              Completar inspección
            </button>
          </div>
        ) : null}
      </header>

      {isReadOnlyInspection ? (
        <p className="app-alert app-alert--info" role="status">
          Inspección completada. Los puntos ya no pueden modificarse.
        </p>
      ) : null}

      {detail.notes !== null && detail.notes !== '' ? (
        <div className="inspection-notes-block">
          <h4>Notas de la inspección</h4>
          <p>{detail.notes}</p>
        </div>
      ) : null}

      {completeHighlight && incompleteCount > 0 ? (
        <p className="app-alert app-alert--error" role="alert">
          Todos los puntos deben tener una condición antes de completar la
          inspección.
        </p>
      ) : null}

      <div className="inspection-items-header">
        <h4>Puntos de revisión</h4>
        {canMutateInspection ? (
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={onAddItem}
          >
            Agregar punto
          </button>
        ) : null}
      </div>

      {itemMediaError !== null ? (
        <p className="app-alert app-alert--error" role="alert">
          {itemMediaError}
        </p>
      ) : null}

      {evidenceError !== null ? (
        <p className="app-alert app-alert--error" role="alert">
          {evidenceError}
        </p>
      ) : null}

      {detail.items.length === 0 ? (
        <p className="app-muted">Esta inspección aún no tiene puntos.</p>
      ) : (
        <ul className="inspection-items">
          {detail.items.map((item) => (
            <li key={item.id}>
              <article
                className={
                  completeHighlight && item.condition === null
                    ? 'inspection-item-card inspection-item-card--incomplete'
                    : 'inspection-item-card'
                }
              >
                <h5>{item.label}</h5>
                {item.description !== null && item.description !== '' ? (
                  <p className="inspection-item-description">{item.description}</p>
                ) : null}

                <div className="inspection-item-field">
                  <span className="inspection-item-label">Condición</span>
                  <InspectionConditionSelector
                    namePrefix={`item-${item.id}`}
                    value={item.condition}
                    readOnly={!canMutateInspection}
                    disabled={!canMutateInspection}
                    pending={pendingItemId === item.id}
                    highlightMissing={completeHighlight}
                    onSelect={(condition) => {
                      void onConditionSelect(item, condition);
                    }}
                  />
                </div>

                {item.notes !== null && item.notes !== '' ? (
                  <div className="inspection-item-field">
                    <span className="inspection-item-label">Notas</span>
                    <p>{item.notes}</p>
                  </div>
                ) : canMutateInspection ? null : (
                  <div className="inspection-item-field">
                    <span className="inspection-item-label">Notas</span>
                    <p className="app-muted">Sin notas</p>
                  </div>
                )}

                <div className="inspection-item-field inspection-item-evidence">
                  <MediaGallerySection
                    title="Evidencia fotográfica"
                    media={itemMedia[item.id] ?? []}
                    canMutate={canMutateInspection}
                    uploadLabel="Agregar foto"
                    altContext={item.label}
                    compact
                    onUploadFile={async (file) => {
                      const created = await uploadInspectionItemMediaRequest(
                        detail.id,
                        item.id,
                        file,
                      );
                      onItemMediaAdded(item.id, created);
                    }}
                    onMediaRemoved={(mediaId) => {
                      onItemMediaRemoved(item.id, mediaId);
                    }}
                    onMediaUpdated={(updated) => {
                      onItemMediaUpdated(item.id, updated);
                    }}
                    onError={(message) => {
                      if (message === '') {
                        setEvidenceError(null);
                      } else {
                        setEvidenceError(message);
                      }
                    }}
                    onSuccess={() => {
                      setEvidenceError(null);
                    }}
                  />
                </div>

                {canMutateInspection ? (
                  <div className="inspection-item-actions">
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
    </div>
  );
}

function CreateInspectionModal({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    notes: string | null;
    items: Array<{ label: string }>;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('Inspección general');
  const [notes, setNotes] = useState('');
  const [pointLabels, setPointLabels] = useState<string[]>(['', '', '']);

  useEffect(() => {
    if (open) {
      setTitle('Inspección general');
      setNotes('');
      setPointLabels(['', '', '']);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = pointLabels
      .map((label) => label.trim())
      .filter((label) => label.length >= 2)
      .map((label) => ({ label }));

    await onSubmit({
      title,
      notes: notes.trim() === '' ? null : notes.trim(),
      items,
    });
  }

  return (
    <Modal
      title="Nueva inspección"
      description="Registra una revisión para esta orden de trabajo."
      open={open}
      onClose={onClose}
    >
      <form className="app-modal-form" onSubmit={handleSubmit}>
        <div className="app-field app-field--full">
          <label htmlFor="inspection-create-title">Título</label>
          <input
            id="inspection-create-title"
            required
            minLength={2}
            maxLength={200}
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="inspection-create-notes">
            Notas <span className="app-field-optional">(opcional)</span>
          </label>
          <textarea
            id="inspection-create-notes"
            value={notes}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <fieldset className="app-field app-field--full inspection-initial-points">
          <legend>Puntos iniciales</legend>
          <span className="app-field-hint">
            Opcional. También puedes agregar puntos después.
          </span>
          {pointLabels.map((label, index) => (
            <input
              key={index}
              aria-label={`Punto inicial ${index + 1}`}
              placeholder="Ej. Luces"
              value={label}
              disabled={pending}
              minLength={2}
              onChange={(event) => {
                setPointLabels((current) =>
                  current.map((row, rowIndex) =>
                    rowIndex === index ? event.target.value : row,
                  ),
                );
              }}
            />
          ))}
          <button
            type="button"
            className="app-button app-button--ghost app-button--compact"
            disabled={pending}
            onClick={() => setPointLabels((current) => [...current, ''])}
          >
            + Agregar otro punto
          </button>
        </fieldset>
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
            {pending ? 'Creando…' : 'Crear inspección'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function EditInspectionModal({
  open,
  pending,
  inspection,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  inspection: InspectionDetail;
  onClose: () => void;
  onSubmit: (input: { title: string; notes: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState(inspection.title);
  const [notes, setNotes] = useState(inspection.notes ?? '');

  useEffect(() => {
    if (open) {
      setTitle(inspection.title);
      setNotes(inspection.notes ?? '');
    }
  }, [open, inspection]);

  return (
    <Modal title="Editar inspección" open={open} onClose={onClose}>
      <form
        className="app-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            title,
            notes: notes.trim() === '' ? null : notes.trim(),
          });
        }}
      >
        <div className="app-field app-field--full">
          <label htmlFor="inspection-edit-title">Título</label>
          <input
            id="inspection-edit-title"
            required
            minLength={2}
            maxLength={200}
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="inspection-edit-notes">Notas</label>
          <textarea
            id="inspection-edit-notes"
            value={notes}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
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
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function AddItemModal({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { label: string; description: string | null }) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setLabel('');
      setDescription('');
    }
  }, [open]);

  return (
    <Modal title="Agregar punto" open={open} onClose={onClose}>
      <form
        className="app-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            label,
            description: description.trim() === '' ? null : description.trim(),
          });
        }}
      >
        <div className="app-field app-field--full">
          <label htmlFor="inspection-item-label">Nombre del punto</label>
          <input
            id="inspection-item-label"
            required
            minLength={2}
            maxLength={200}
            value={label}
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="inspection-item-description">
            Descripción <span className="app-field-optional">(opcional)</span>
          </label>
          <textarea
            id="inspection-item-description"
            value={description}
            disabled={pending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
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
            {pending ? 'Agregando…' : 'Agregar punto'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function EditItemModal({
  open,
  pending,
  item,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  item: InspectionItem | null;
  onClose: () => void;
  onSubmit: (input: {
    label: string;
    description: string | null;
    notes: string | null;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open && item !== null) {
      setLabel(item.label);
      setDescription(item.description ?? '');
      setNotes(item.notes ?? '');
    }
  }, [open, item]);

  if (item === null) {
    return null;
  }

  return (
    <Modal title="Editar punto" open={open} onClose={onClose}>
      <form
        className="app-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            label,
            description: description.trim() === '' ? null : description.trim(),
            notes: notes.trim() === '' ? null : notes.trim(),
          });
        }}
      >
        <div className="app-field app-field--full">
          <label htmlFor="inspection-edit-item-label">Nombre</label>
          <input
            id="inspection-edit-item-label"
            required
            minLength={2}
            maxLength={200}
            value={label}
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="inspection-edit-item-description">Descripción</label>
          <textarea
            id="inspection-edit-item-description"
            value={description}
            disabled={pending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="app-field app-field--full">
          <label htmlFor="inspection-edit-item-notes">Notas</label>
          <textarea
            id="inspection-edit-item-notes"
            value={notes}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
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
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function DeleteItemModal({
  open,
  pending,
  item,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  item: InspectionItem | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal
      title="Eliminar punto"
      description={
        item === null
          ? undefined
          : `¿Eliminar "${item.label}"? Esta acción no se puede deshacer.`
      }
      open={open}
      onClose={onClose}
    >
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
          onClick={() => {
            void onConfirm();
          }}
        >
          {pending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function CompleteInspectionModal({
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
    <Modal
      title="Completar inspección"
      description="Después de completarla ya no podrás modificar sus puntos."
      open={open}
      onClose={onClose}
    >
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
          onClick={() => {
            void onConfirm();
          }}
        >
          {pending ? 'Completando…' : 'Completar inspección'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
