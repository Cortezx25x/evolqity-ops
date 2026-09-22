import { useEffect, useState } from 'react';

import { fetchMediaContentBlob } from '../api/media.api';
import { TenantNotReadyError } from '../api/api-client';
import { useOrganization } from '../contexts/OrganizationContext';

export function useMediaObjectUrl(mediaId: string | null) {
  const { isTenantReady } = useOrganization();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isTenantReady || mediaId === null) {
      setObjectUrl(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    async function load() {
      setLoading(true);
      setFailed(false);
      setObjectUrl(null);

      try {
        const blob = await fetchMediaContentBlob(mediaId as string);
        if (cancelled) {
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      } catch (error) {
        if (!cancelled && !(error instanceof TenantNotReadyError)) {
          setFailed(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (createdUrl !== null) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isTenantReady, mediaId]);

  return { objectUrl, loading, failed };
}
