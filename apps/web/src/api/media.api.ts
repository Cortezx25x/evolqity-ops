import {
  apiFetchBlob,
  apiRequest,
  apiUploadMultipart,
} from './api-client';
import type { WorkOrderMembershipSummary } from './types';

export interface MediaItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: string;
  uploadedBy: WorkOrderMembershipSummary;
}

export async function listWorkOrderMediaRequest(
  workOrderId: string,
): Promise<MediaItem[]> {
  return apiRequest<MediaItem[]>(
    `/api/work-orders/${workOrderId}/media`,
    { method: 'GET' },
  );
}

export async function listInspectionMediaRequest(
  inspectionId: string,
): Promise<MediaItem[]> {
  return apiRequest<MediaItem[]>(
    `/api/inspections/${inspectionId}/media`,
    { method: 'GET' },
  );
}

export async function listInspectionItemMediaRequest(
  inspectionId: string,
  itemId: string,
): Promise<MediaItem[]> {
  return apiRequest<MediaItem[]>(
    `/api/inspections/${inspectionId}/items/${itemId}/media`,
    { method: 'GET' },
  );
}

export async function uploadWorkOrderMediaRequest(
  workOrderId: string,
  file: File,
  caption?: string | null,
): Promise<MediaItem> {
  return apiUploadMultipart<MediaItem>(
    `/api/work-orders/${workOrderId}/media`,
    file,
    caption,
  );
}

export async function uploadInspectionMediaRequest(
  inspectionId: string,
  file: File,
  caption?: string | null,
): Promise<MediaItem> {
  return apiUploadMultipart<MediaItem>(
    `/api/inspections/${inspectionId}/media`,
    file,
    caption,
  );
}

export async function uploadInspectionItemMediaRequest(
  inspectionId: string,
  itemId: string,
  file: File,
  caption?: string | null,
): Promise<MediaItem> {
  return apiUploadMultipart<MediaItem>(
    `/api/inspections/${inspectionId}/items/${itemId}/media`,
    file,
    caption,
  );
}

export async function fetchMediaContentBlob(mediaId: string): Promise<Blob> {
  return apiFetchBlob(`/api/media/${mediaId}/content`, { method: 'GET' });
}

export async function updateMediaCaptionRequest(
  mediaId: string,
  caption: string | null,
): Promise<MediaItem> {
  return apiRequest<MediaItem>(`/api/media/${mediaId}`, {
    method: 'PATCH',
    body: { caption },
  });
}

export async function deleteMediaRequest(mediaId: string): Promise<void> {
  await apiRequest<void>(`/api/media/${mediaId}`, { method: 'DELETE' });
}
