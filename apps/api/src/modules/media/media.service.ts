import type { Readable } from 'node:stream';

import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { mediaCaptionValueSchema, type UpdateMediaBody } from './media.schemas.js';
import { LocalMediaStorage } from './storage/local-media-storage.js';
import type { MediaStorage } from './storage/media-storage.js';

export type MediaParent =
  | { kind: 'WORK_ORDER'; workOrderId: string }
  | { kind: 'INSPECTION'; inspectionId: string }
  | {
      kind: 'INSPECTION_ITEM';
      inspectionId: string;
      itemId: string;
    };

export interface MediaUploadInput {
  source: Readable;
  originalName: string;
  resolveCaption: () => unknown;
  isTruncated: () => boolean;
}

export class MediaWorkOrderNotFoundError extends Error {
  constructor() {
    super('Work order not found');
    this.name = 'MediaWorkOrderNotFoundError';
  }
}

export class MediaWorkOrderClosedError extends Error {
  constructor() {
    super('Work order is closed');
    this.name = 'MediaWorkOrderClosedError';
  }
}

export class MediaInspectionNotFoundError extends Error {
  constructor() {
    super('Inspection not found');
    this.name = 'MediaInspectionNotFoundError';
  }
}

export class MediaInspectionCompletedError extends Error {
  constructor() {
    super('Inspection is completed');
    this.name = 'MediaInspectionCompletedError';
  }
}

export class MediaInspectionItemNotFoundError extends Error {
  constructor() {
    super('Inspection item not found');
    this.name = 'MediaInspectionItemNotFoundError';
  }
}

export class MediaNotFoundError extends Error {
  constructor() {
    super('Media not found');
    this.name = 'MediaNotFoundError';
  }
}

export class InvalidMediaMembershipError extends Error {
  constructor() {
    super('Invalid membership');
    this.name = 'InvalidMediaMembershipError';
  }
}

export class InvalidMediaMultipartFieldsError extends Error {
  constructor() {
    super('Invalid multipart fields');
    this.name = 'InvalidMediaMultipartFieldsError';
  }
}

export class MediaFileTooLargeError extends Error {
  constructor() {
    super('File too large');
    this.name = 'MediaFileTooLargeError';
  }
}

export class InvalidMediaOwnerError extends Error {
  constructor() {
    super('Invalid media owner');
    this.name = 'InvalidMediaOwnerError';
  }
}

const defaultMediaStorage = new LocalMediaStorage(env.MEDIA_LOCAL_ROOT);

const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

const publicMediaSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  caption: true,
  createdAt: true,
  uploadedBy: {
    select: {
      id: true,
      user: { select: userSummarySelect },
    },
  },
} as const;

type PublicMediaRecord = Prisma.MediaGetPayload<{
  select: typeof publicMediaSelect;
}>;

function toPublicMedia(media: PublicMediaRecord) {
  const { uploadedBy, ...fields } = media;

  return {
    ...fields,
    uploadedBy: {
      membershipId: uploadedBy.id,
      user: uploadedBy.user,
    },
  };
}

function normalizeOriginalName(originalName: string): string {
  const withoutPath = originalName.split(/[\\/]/).at(-1) ?? '';
  const normalized = withoutPath
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 255);

  return normalized === '' ? 'upload' : normalized;
}

async function requireActiveMembership(
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const membership = await prisma.organizationUser.findFirst({
    where: {
      id: membershipId,
      organizationId,
      active: true,
    },
    select: { id: true },
  });

  if (membership === null) {
    throw new InvalidMediaMembershipError();
  }
}

async function authorizeMediaParent(
  organizationId: string,
  parent: MediaParent,
  mutable: boolean,
): Promise<void> {
  if (parent.kind === 'WORK_ORDER') {
    const workOrder = await prisma.workOrder.findFirst({
      where: {
        id: parent.workOrderId,
        organizationId,
      },
      select: { status: true },
    });

    if (workOrder === null) {
      throw new MediaWorkOrderNotFoundError();
    }
    if (
      mutable &&
      (workOrder.status === 'COMPLETED' ||
        workOrder.status === 'CANCELLED')
    ) {
      throw new MediaWorkOrderClosedError();
    }
    return;
  }

  const inspection = await prisma.inspection.findFirst({
    where: {
      id: parent.inspectionId,
      organizationId,
    },
    select: {
      status: true,
      workOrder: { select: { status: true } },
    },
  });

  if (inspection === null) {
    throw new MediaInspectionNotFoundError();
  }
  if (mutable && inspection.status === 'COMPLETED') {
    throw new MediaInspectionCompletedError();
  }
  if (
    mutable &&
    (inspection.workOrder.status === 'COMPLETED' ||
      inspection.workOrder.status === 'CANCELLED')
  ) {
    throw new MediaWorkOrderClosedError();
  }

  if (parent.kind === 'INSPECTION_ITEM') {
    const item = await prisma.inspectionItem.findFirst({
      where: {
        id: parent.itemId,
        inspectionId: parent.inspectionId,
      },
      select: { id: true },
    });

    if (item === null) {
      throw new MediaInspectionItemNotFoundError();
    }
  }
}

function parentCreateData(parent: MediaParent) {
  return {
    workOrderId: parent.kind === 'WORK_ORDER' ? parent.workOrderId : null,
    inspectionId:
      parent.kind === 'INSPECTION' ? parent.inspectionId : null,
    inspectionItemId:
      parent.kind === 'INSPECTION_ITEM' ? parent.itemId : null,
  };
}

export async function uploadMedia(
  organizationId: string,
  uploadedByMembershipId: string,
  parent: MediaParent,
  input: MediaUploadInput,
  storage: MediaStorage = defaultMediaStorage,
) {
  await authorizeMediaParent(organizationId, parent, true);
  await requireActiveMembership(organizationId, uploadedByMembershipId);

  const saved = await storage.save(input.source);

  try {
    if (input.isTruncated()) {
      throw new MediaFileTooLargeError();
    }

    const parsedCaption = mediaCaptionValueSchema.safeParse(
      input.resolveCaption(),
    );

    if (!parsedCaption.success) {
      throw new InvalidMediaMultipartFieldsError();
    }

    const media = await prisma.media.create({
      data: {
        organizationId,
        ...parentCreateData(parent),
        storageKey: saved.storageKey,
        originalName: normalizeOriginalName(input.originalName),
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        sha256: saved.sha256,
        caption: parsedCaption.data ?? null,
        uploadedByMembershipId,
      },
      select: publicMediaSelect,
    });

    return toPublicMedia(media);
  } catch (error) {
    await storage.delete(saved.storageKey).catch(() => {});
    throw error;
  }
}

export async function listMediaForParent(
  organizationId: string,
  parent: MediaParent,
) {
  await authorizeMediaParent(organizationId, parent, false);

  const media = await prisma.media.findMany({
    where: {
      organizationId,
      ...parentCreateData(parent),
    },
    orderBy: { createdAt: 'asc' },
    select: publicMediaSelect,
  });

  return media.map(toPublicMedia);
}

export async function getMediaMetadata(
  organizationId: string,
  mediaId: string,
) {
  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      organizationId,
    },
    select: publicMediaSelect,
  });

  return media === null ? null : toPublicMedia(media);
}

async function getMutableMedia(
  organizationId: string,
  mediaId: string,
) {
  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      organizationId,
    },
    select: {
      id: true,
      storageKey: true,
      workOrderId: true,
      inspectionId: true,
      inspectionItemId: true,
      inspectionItem: { select: { inspectionId: true } },
    },
  });

  if (media === null) {
    throw new MediaNotFoundError();
  }

  const ownerCount = [
    media.workOrderId,
    media.inspectionId,
    media.inspectionItemId,
  ].filter((value) => value !== null).length;

  if (ownerCount !== 1) {
    throw new InvalidMediaOwnerError();
  }

  let parent: MediaParent;
  if (media.workOrderId !== null) {
    parent = { kind: 'WORK_ORDER', workOrderId: media.workOrderId };
  } else if (media.inspectionId !== null) {
    parent = { kind: 'INSPECTION', inspectionId: media.inspectionId };
  } else if (
    media.inspectionItemId !== null &&
    media.inspectionItem !== null
  ) {
    parent = {
      kind: 'INSPECTION_ITEM',
      inspectionId: media.inspectionItem.inspectionId,
      itemId: media.inspectionItemId,
    };
  } else {
    throw new InvalidMediaOwnerError();
  }

  await authorizeMediaParent(organizationId, parent, true);
  return media;
}

export async function updateMediaCaption(
  organizationId: string,
  mediaId: string,
  input: UpdateMediaBody,
) {
  await getMutableMedia(organizationId, mediaId);

  const result = await prisma.media.updateMany({
    where: {
      id: mediaId,
      organizationId,
    },
    data: { caption: input.caption === '' ? null : input.caption },
  });

  if (result.count !== 1) {
    throw new MediaNotFoundError();
  }

  return getMediaMetadata(organizationId, mediaId);
}

export async function openMediaContent(
  organizationId: string,
  mediaId: string,
  storage: MediaStorage = defaultMediaStorage,
) {
  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      organizationId,
    },
    select: {
      originalName: true,
      mimeType: true,
      storageKey: true,
    },
  });

  if (media === null) {
    throw new MediaNotFoundError();
  }

  const opened = await storage.open(media.storageKey);

  return {
    ...opened,
    originalName: media.originalName,
    mimeType: media.mimeType,
  };
}

export async function deleteMedia(
  organizationId: string,
  mediaId: string,
  storage: MediaStorage = defaultMediaStorage,
) {
  const media = await getMutableMedia(organizationId, mediaId);
  const result = await prisma.media.deleteMany({
    where: {
      id: mediaId,
      organizationId,
    },
  });

  if (result.count !== 1) {
    throw new MediaNotFoundError();
  }

  let storageDeleteFailed = false;
  try {
    await storage.delete(media.storageKey);
  } catch {
    storageDeleteFailed = true;
  }

  return { storageDeleteFailed };
}
