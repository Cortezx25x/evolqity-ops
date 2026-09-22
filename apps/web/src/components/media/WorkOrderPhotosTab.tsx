import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listWorkOrderMediaRequest,
  uploadWorkOrderMediaRequest,
  type MediaItem,
} from '../../api/media.api';
import { TenantNotReadyError } from '../../api/api-client';
import { useOrganization } from '../../contexts/OrganizationContext';
import { messageForMediaApiError } from '../../lib/media';
import { MediaGallerySection } from '../media/MediaGallerySection';

export interface WorkOrderPhotosTabProps {
  workOrderId: string;
  workOrderClosed: boolean;
}

export function WorkOrderPhotosTab({
  workOrderId,
  workOrderClosed,
}: WorkOrderPhotosTabProps) {
  const { isTenantReady } = useOrganization();
  const requestId = useRef(0);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    if (!isTenantReady) {
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const list = await listWorkOrderMediaRequest(workOrderId);
      if (currentRequest !== requestId.current) {
        return;
      }
      setMedia(list);
    } catch (caught) {
      if (currentRequest !== requestId.current) {
        return;
      }
      if (caught instanceof TenantNotReadyError) {
        return;
      }
      setError(messageForMediaApiError(caught));
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
      }
    }
  }, [isTenantReady, workOrderId]);

  useEffect(() => {
    if (!isTenantReady) {
      setLoading(true);
      return;
    }
    void loadMedia();
  }, [isTenantReady, loadMedia]);

  return (
    <section className="app-panel">
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
          Esta orden está cerrada. Las fotografías son de solo lectura.
        </p>
      ) : null}

      <MediaGallerySection
        title="Fotos"
        lead="Evidencia fotográfica de la orden de trabajo."
        media={media}
        loading={loading}
        canMutate={!workOrderClosed}
        uploadLabel="Agregar fotos"
        altContext="la orden de trabajo"
        onUploadFile={async (file) => {
          const created = await uploadWorkOrderMediaRequest(workOrderId, file);
          setMedia((current) => [...current, created]);
        }}
        onMediaRemoved={(mediaId) => {
          setMedia((current) => current.filter((row) => row.id !== mediaId));
        }}
        onMediaUpdated={(updated) => {
          setMedia((current) =>
            current.map((row) => (row.id === updated.id ? updated : row)),
          );
        }}
        onError={(message) => {
          if (message === '') {
            setError(null);
          } else {
            setError(message);
          }
        }}
        onSuccess={(message) => {
          setSuccess(message);
        }}
      />
    </section>
  );
}
