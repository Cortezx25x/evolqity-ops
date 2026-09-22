import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import type { MediaItem } from '../../api/media.api';
import {
  deleteMediaRequest,
  updateMediaCaptionRequest,
} from '../../api/media.api';
import { TenantNotReadyError } from '../../api/api-client';
import { formatDisplayDate } from '../../lib/dates';
import { MEDIA_ACCEPT, messageForMediaApiError, validateMediaFileForUpload } from '../../lib/media';
import { useMediaObjectUrl } from '../../hooks/useMediaObjectUrl';
import { Modal, ModalFooter } from '../Modal';
import './media.css';

export interface MediaGallerySectionProps {
  title?: string;
  lead?: string;
  media: MediaItem[];
  loading?: boolean;
  canMutate: boolean;
  uploadLabel?: string;
  altContext: string;
  compact?: boolean;
  onUploadFile: (file: File) => Promise<void>;
  onMediaRemoved: (mediaId: string) => void;
  onMediaUpdated: (media: MediaItem) => void;
  onError: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export function MediaGallerySection({
  title,
  lead,
  media,
  loading = false,
  canMutate,
  uploadLabel = 'Agregar fotos',
  altContext,
  compact = false,
  onUploadFile,
  onMediaRemoved,
  onMediaUpdated,
  onError,
  onSuccess,
}: MediaGallerySectionProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<MediaItem | null>(null);
  const [captionTarget, setCaptionTarget] = useState<MediaItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [captionPending, setCaptionPending] = useState(false);

  async function handleFilesSelected(files: FileList | null) {
    if (files === null || files.length === 0 || uploading) {
      return;
    }

    setUploading(true);
    onError('');

    const fileArray = [...files];
    let uploadedCount = 0;

    for (const file of fileArray) {
      const validationError = validateMediaFileForUpload(file);
      if (validationError !== null) {
        onError(validationError);
        continue;
      }

      try {
        await onUploadFile(file);
        uploadedCount += 1;
      } catch (caught) {
        if (!(caught instanceof TenantNotReadyError)) {
          onError(messageForMediaApiError(caught));
        }
      }
    }

    if (uploadedCount > 0) {
      onSuccess?.(
        uploadedCount === 1
          ? 'Fotografía agregada.'
          : `${uploadedCount} fotografías agregadas.`,
      );
    }

    setUploading(false);
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  }

  return (
    <section
      className={
        compact ? 'media-section media-section--compact' : 'media-section'
      }
    >
      {title !== undefined ? (
        <header className="media-section-header">
          <div>
            {title !== '' ? <h3>{title}</h3> : null}
            {lead !== undefined ? <p className="app-muted">{lead}</p> : null}
          </div>
          {canMutate ? (
            <>
              <input
                ref={inputRef}
                id={inputId}
                className="visually-hidden"
                type="file"
                accept={MEDIA_ACCEPT}
                multiple
                disabled={uploading}
                onChange={(event) => {
                  void handleFilesSelected(event.target.files);
                }}
              />
              <label
                htmlFor={inputId}
                className={
                  uploading
                    ? 'app-button app-button--primary is-disabled'
                    : 'app-button app-button--primary'
                }
              >
                {uploading ? 'Subiendo…' : uploadLabel}
              </label>
            </>
          ) : null}
        </header>
      ) : null}

      {loading ? (
        <p className="app-muted" role="status">
          Cargando fotografías…
        </p>
      ) : media.length === 0 ? (
        <p className="app-muted">Aún no hay fotografías.</p>
      ) : (
        <ul className="media-grid">
          {media.map((item) => (
            <li key={item.id}>
              <MediaCard
                media={item}
                alt={`Fotografía de ${altContext}`}
                canMutate={canMutate}
                onPreview={() => setPreviewMedia(item)}
                onEditCaption={() => setCaptionTarget(item)}
                onDelete={() => setDeleteTarget(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <MediaPreviewModal
        media={previewMedia}
        alt={`Fotografía de ${altContext}`}
        onClose={() => setPreviewMedia(null)}
      />

      <MediaCaptionModal
        media={captionTarget}
        pending={captionPending}
        open={captionTarget !== null}
        onClose={() => {
          if (!captionPending) {
            setCaptionTarget(null);
          }
        }}
        onSubmit={async (caption) => {
          if (captionTarget === null) {
            return;
          }
          setCaptionPending(true);
          try {
            const updated = await updateMediaCaptionRequest(
              captionTarget.id,
              caption,
            );
            onMediaUpdated(updated);
            setCaptionTarget(null);
            onSuccess?.('Cambios guardados.');
          } catch (caught) {
            onError(messageForMediaApiError(caught));
          } finally {
            setCaptionPending(false);
          }
        }}
      />

      <MediaDeleteModal
        media={deleteTarget}
        pending={deletePending}
        open={deleteTarget !== null}
        onClose={() => {
          if (!deletePending) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={async () => {
          if (deleteTarget === null) {
            return;
          }
          setDeletePending(true);
          try {
            await deleteMediaRequest(deleteTarget.id);
            onMediaRemoved(deleteTarget.id);
            setDeleteTarget(null);
            onSuccess?.('Fotografía eliminada.');
          } catch (caught) {
            onError(messageForMediaApiError(caught));
          } finally {
            setDeletePending(false);
          }
        }}
      />
    </section>
  );
}

function MediaCard({
  media,
  alt,
  canMutate,
  onPreview,
  onEditCaption,
  onDelete,
}: {
  media: MediaItem;
  alt: string;
  canMutate: boolean;
  onPreview: () => void;
  onEditCaption: () => void;
  onDelete: () => void;
}) {
  const { objectUrl, loading, failed } = useMediaObjectUrl(media.id);

  return (
    <article className="media-card">
      <button
        type="button"
        className="media-card-thumb"
        onClick={onPreview}
        aria-label={`Ver ${alt}`}
      >
        {loading ? (
          <span className="media-card-placeholder" aria-hidden="true" />
        ) : failed || objectUrl === null ? (
          <span className="media-card-broken">No disponible</span>
        ) : (
          <img src={objectUrl} alt={alt} loading="lazy" />
        )}
      </button>
      <div className="media-card-meta">
        {media.caption !== null && media.caption !== '' ? (
          <p className="media-card-caption">{media.caption}</p>
        ) : (
          <p className="media-card-caption app-muted">Sin descripción</p>
        )}
        <p className="media-card-date">{formatDisplayDate(media.createdAt)}</p>
      </div>
      {canMutate ? (
        <div className="media-card-actions">
          <button
            type="button"
            className="app-button app-button--ghost app-button--compact"
            onClick={onEditCaption}
          >
            Editar descripción
          </button>
          <button
            type="button"
            className="app-button app-button--danger app-button--compact"
            onClick={onDelete}
          >
            Eliminar
          </button>
        </div>
      ) : null}
    </article>
  );
}

function MediaPreviewModal({
  media,
  alt,
  onClose,
}: {
  media: MediaItem | null;
  alt: string;
  onClose: () => void;
}) {
  const { objectUrl, loading, failed } = useMediaObjectUrl(
    media === null ? null : media.id,
  );

  return (
    <Modal
      title="Vista previa"
      open={media !== null}
      onClose={onClose}
      size="wide"
      showCloseButton
    >
      <div className="media-preview-body">
        {loading ? (
          <p className="app-muted" role="status">
            Cargando imagen…
          </p>
        ) : failed || objectUrl === null ? (
          <p className="app-muted">No pudimos mostrar esta fotografía.</p>
        ) : (
          <img
            className="media-preview-image"
            src={objectUrl}
            alt={alt}
          />
        )}
        {media !== null &&
        media.caption !== null &&
        media.caption !== '' ? (
          <p className="media-preview-caption">{media.caption}</p>
        ) : null}
      </div>
      <ModalFooter>
        <button
          type="button"
          className="app-button app-button--ghost"
          onClick={onClose}
        >
          Cerrar
        </button>
      </ModalFooter>
    </Modal>
  );
}

function MediaCaptionModal({
  open,
  pending,
  media,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  media: MediaItem | null;
  onClose: () => void;
  onSubmit: (caption: string | null) => Promise<void>;
}) {
  const [caption, setCaption] = useState('');

  useEffect(() => {
    if (open && media !== null) {
      setCaption(media.caption ?? '');
    }
  }, [open, media]);

  return (
    <Modal title="Editar descripción" open={open} onClose={onClose}>
      <form
        className="app-modal-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit(caption.trim() === '' ? null : caption.trim());
        }}
      >
        <div className="app-field app-field--full">
          <label htmlFor="media-caption">Descripción</label>
          <textarea
            id="media-caption"
            maxLength={500}
            value={caption}
            disabled={pending}
            onChange={(event) => setCaption(event.target.value)}
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

function MediaDeleteModal({
  open,
  pending,
  media,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  media: MediaItem | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal
      title="Eliminar fotografía"
      description="Esta fotografía se eliminará permanentemente."
      open={open}
      onClose={onClose}
    >
      {media !== null ? (
        <p className="app-muted">{media.caption ?? media.originalName}</p>
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
