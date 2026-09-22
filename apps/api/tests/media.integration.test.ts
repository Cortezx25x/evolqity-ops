import { createHash, randomUUID } from 'node:crypto';
import { promises as filesystem } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type { OrganizationRole } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';
import { uploadMedia } from '../src/modules/media/media.service.js';
import { LocalMediaStorage } from '../src/modules/media/storage/local-media-storage.js';
import type {
  MediaStorage,
  OpenedMediaFile,
  SavedMediaFile,
} from '../src/modules/media/storage/media-storage.js';

interface TenantIdentity {
  organizationId: string;
  membershipId: string;
  accessToken: string;
}

interface PublicMedia {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: string;
  uploadedBy: {
    membershipId: string;
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    };
  };
}

const jpegBytes = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const webpBytes = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
  'base64',
);

function headers(
  accessToken: string,
  organizationId?: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(organizationId === undefined
      ? {}
      : { 'x-organization-id': organizationId }),
  };
}

function multipartPayload(options: {
  bytes: Buffer;
  filename?: string;
  contentType?: string;
  caption?: string;
  fields?: Record<string, string>;
}) {
  const boundary = `evolqity-${randomUUID()}`;
  const chunks: Buffer[] = [];
  const fields = {
    ...(options.caption === undefined ? {} : { caption: options.caption }),
    ...options.fields,
  };

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? 'photo.jpg'}"\r\nContent-Type: ${options.contentType ?? 'image/jpeg'}\r\n\r\n`,
    ),
    options.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  const payload = Buffer.concat(chunks);
  return {
    payload,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('media API', () => {
  let app: FastifyInstance;
  let sequence = 0;
  const storageRoot = path.resolve(env.MEDIA_LOCAL_ROOT);

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
  }

  async function createTenant(
    prefix: string,
    role: OrganizationRole = 'OWNER',
  ): Promise<TenantIdentity> {
    const user = await prisma.user.create({
      data: { email: `${unique(prefix)}@example.com` },
      select: { id: true },
    });
    const organization = await prisma.organization.create({
      data: { name: `${prefix} Organization`, slug: unique(prefix) },
      select: { id: true },
    });
    const membership = await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role,
      },
      select: { id: true },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });

    return {
      organizationId: organization.id,
      membershipId: membership.id,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createWorkOrder(tenant: TenantIdentity) {
    const customer = await prisma.customer.create({
      data: {
        organizationId: tenant.organizationId,
        name: unique('Customer'),
      },
      select: { id: true },
    });

    return prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.update({
        where: { id: tenant.organizationId },
        data: { nextWorkOrderNumber: { increment: 1 } },
        select: { nextWorkOrderNumber: true },
      });

      return transaction.workOrder.create({
        data: {
          organizationId: tenant.organizationId,
          customerId: customer.id,
          number: organization.nextWorkOrderNumber - 1,
          title: unique('Work Order'),
          createdByMembershipId: tenant.membershipId,
        },
        select: { id: true },
      });
    });
  }

  async function createInspection(
    tenant: TenantIdentity,
    workOrderId: string,
    options: { completed?: boolean; withItem?: boolean } = {},
  ) {
    return prisma.inspection.create({
      data: {
        organizationId: tenant.organizationId,
        workOrderId,
        title: unique('Inspection'),
        createdByMembershipId: tenant.membershipId,
        status: options.completed ? 'COMPLETED' : 'DRAFT',
        completedAt: options.completed ? new Date() : null,
        completedByMembershipId: options.completed
          ? tenant.membershipId
          : null,
        nextItemOrder: options.withItem ? 2 : 1,
        ...(options.withItem
          ? {
              items: {
                create: {
                  label: 'Inspection item',
                  sortOrder: 1,
                },
              },
            }
          : {}),
      },
      include: { items: true },
    });
  }

  async function upload(
    tenant: TenantIdentity,
    url: string,
    options: Parameters<typeof multipartPayload>[0],
  ) {
    const multipart = multipartPayload(options);
    return app.inject({
      method: 'POST',
      url,
      headers: {
        ...headers(tenant.accessToken, tenant.organizationId),
        'content-type': multipart.contentType,
        'content-length': String(multipart.payload.length),
      },
      payload: multipart.payload,
    });
  }

  async function uploadToWorkOrder(
    tenant: TenantIdentity,
    workOrderId: string,
    options: Parameters<typeof multipartPayload>[0] = { bytes: jpegBytes },
  ) {
    return upload(tenant, `/api/work-orders/${workOrderId}/media`, options);
  }

  beforeAll(async () => {
    const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
    const safeBase = path.resolve(tmpdir(), 'evolqity-ops-media-test');
    const relativeRoot = path.relative(safeBase, storageRoot);

    if (!databaseName.endsWith('_test')) {
      throw new Error(
        'Integration tests refuse to run unless DATABASE_URL targets a *_test database.',
      );
    }
    if (
      relativeRoot === '..' ||
      relativeRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRoot)
    ) {
      throw new Error(
        'Media tests refuse to use a storage root outside the controlled test directory.',
      );
    }

    app = await buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.estimatePublicToken.deleteMany();
    await prisma.media.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.organizationUser.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
    await filesystem.rm(storageRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await filesystem.rm(storageRoot, { recursive: true, force: true });
  });

  describe('upload validation and storage', () => {
    it.each([
      ['JPEG', jpegBytes, 'photo.png', 'text/plain', 'image/jpeg'],
      ['PNG', pngBytes, 'photo.jpg', 'image/jpeg', 'image/png'],
      ['WEBP', webpBytes, 'photo.bin', 'application/octet-stream', 'image/webp'],
    ] as const)(
      'accepts %s by magic bytes rather than filename or request type',
      async (_label, bytes, filename, contentType, expectedMime) => {
        const tenant = await createTenant(`format-${expectedMime}`);
        const workOrder = await createWorkOrder(tenant);
        const response = await uploadToWorkOrder(tenant, workOrder.id, {
          bytes: Buffer.from(bytes),
          filename,
          contentType,
          caption: '  Evidence  ',
        });
        const body = response.json<PublicMedia>();

        expect(response.statusCode).toBe(201);
        expect(body).toMatchObject({
          originalName: filename,
          mimeType: expectedMime,
          sizeBytes: bytes.length,
          caption: 'Evidence',
          uploadedBy: { membershipId: tenant.membershipId },
        });
        expect(body).not.toHaveProperty('storageKey');
        expect(body).not.toHaveProperty('sha256');
        expect(body).not.toHaveProperty('organizationId');
      },
    );

    it.each([
      ['fake MIME', Buffer.from('plain text'), 'photo.jpg', 'image/jpeg'],
      ['fake extension', Buffer.from('not an image'), 'photo.jpg', 'text/plain'],
      [
        'SVG',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        'photo.svg',
        'image/svg+xml',
      ],
    ] as const)(
      'rejects unsupported content: %s',
      async (_label, bytes, filename, contentType) => {
        const tenant = await createTenant(`invalid-${filename}`);
        const workOrder = await createWorkOrder(tenant);
        const response = await uploadToWorkOrder(tenant, workOrder.id, {
          bytes: Buffer.from(bytes),
          filename,
          contentType,
        });

        expect(response.statusCode).toBe(415);
        expect(response.json()).toEqual({
          message: 'Unsupported media type',
        });
        await expect(prisma.media.count()).resolves.toBe(0);
      },
    );

    it('enforces the file size limit during multipart reception', async () => {
      const tenant = await createTenant('too-large');
      const workOrder = await createWorkOrder(tenant);
      const oversized = Buffer.alloc(env.MEDIA_MAX_FILE_SIZE_BYTES + 1, 0xff);
      jpegBytes.copy(oversized);
      const response = await uploadToWorkOrder(tenant, workOrder.id, {
        bytes: oversized,
      });

      expect(response.statusCode).toBe(413);
      expect(response.json()).toEqual({ message: 'File too large' });
      await expect(prisma.media.count()).resolves.toBe(0);
    });

    it('generates safe unique keys and stores the real SHA-256', async () => {
      const tenant = await createTenant('safe-keys');
      const workOrder = await createWorkOrder(tenant);
      const maliciousName = '..\\..\\control\u0000photo.jpg';
      const first = await uploadToWorkOrder(tenant, workOrder.id, {
        bytes: jpegBytes,
        filename: maliciousName,
      });
      const second = await uploadToWorkOrder(tenant, workOrder.id, {
        bytes: jpegBytes,
        filename: maliciousName,
      });
      const records = await prisma.media.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          storageKey: true,
          originalName: true,
          sha256: true,
        },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(records).toHaveLength(2);
      expect(records[0]?.storageKey).not.toBe(records[1]?.storageKey);
      expect(records.every((record) => record.storageKey.startsWith('media/')))
        .toBe(true);
      expect(records.every((record) => !record.storageKey.includes('..')))
        .toBe(true);
      expect(records.every((record) => record.originalName === 'controlphoto.jpg'))
        .toBe(true);
      expect(records.every((record) => record.sha256 === createHash('sha256')
        .update(jpegBytes)
        .digest('hex'))).toBe(true);

      for (const record of records) {
        const resolved = path.resolve(storageRoot, record.storageKey);
        const relative = path.relative(storageRoot, resolved);
        expect(relative.startsWith('..')).toBe(false);
        await expect(filesystem.stat(resolved)).resolves.toBeTruthy();
      }
    });

    it('rejects path traversal keys in the local adapter', async () => {
      const storage = new LocalMediaStorage(storageRoot);
      await expect(storage.open('../outside.jpg')).rejects.toThrow(
        'Invalid storage key',
      );
      await expect(storage.delete('..\\outside.jpg')).rejects.toThrow(
        'Invalid storage key',
      );
    });
  });

  describe('parent authorization and listing', () => {
    it('uploads and lists only the selected Work Order media', async () => {
      const tenant = await createTenant('work-order-media');
      const firstWorkOrder = await createWorkOrder(tenant);
      const secondWorkOrder = await createWorkOrder(tenant);
      const firstUpload = await uploadToWorkOrder(
        tenant,
        firstWorkOrder.id,
        { bytes: jpegBytes },
      );
      await uploadToWorkOrder(tenant, secondWorkOrder.id, {
        bytes: pngBytes,
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/work-orders/${firstWorkOrder.id}/media`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(firstUpload.statusCode).toBe(201);
      expect(response.statusCode).toBe(200);
      expect(response.json<Array<{ id: string }>>()).toEqual([
        expect.objectContaining({
          id: firstUpload.json<PublicMedia>().id,
        }),
      ]);
    });

    it('hides cross-tenant Work Orders and blocks terminal Work Orders', async () => {
      const tenantA = await createTenant('work-order-scope-a');
      const tenantB = await createTenant('work-order-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const foreign = await uploadToWorkOrder(tenantB, workOrderA.id, {
        bytes: jpegBytes,
      });
      await prisma.workOrder.update({
        where: { id: workOrderA.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const closed = await uploadToWorkOrder(tenantA, workOrderA.id, {
        bytes: jpegBytes,
      });

      expect(foreign.statusCode).toBe(404);
      expect(foreign.json()).toEqual({ message: 'Work order not found' });
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toEqual({ message: 'Work order is closed' });
    });

    it('enforces Inspection lifecycle and tenant ownership', async () => {
      const tenantA = await createTenant('inspection-media-a');
      const tenantB = await createTenant('inspection-media-b');
      const workOrderA = await createWorkOrder(tenantA);
      const draft = await createInspection(tenantA, workOrderA.id);
      const completed = await createInspection(tenantA, workOrderA.id, {
        completed: true,
      });
      const valid = await upload(
        tenantA,
        `/api/inspections/${draft.id}/media`,
        { bytes: pngBytes },
      );
      const foreign = await upload(
        tenantB,
        `/api/inspections/${draft.id}/media`,
        { bytes: pngBytes },
      );
      const terminal = await upload(
        tenantA,
        `/api/inspections/${completed.id}/media`,
        { bytes: pngBytes },
      );
      await prisma.workOrder.update({
        where: { id: workOrderA.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      const closedParent = await upload(
        tenantA,
        `/api/inspections/${draft.id}/media`,
        { bytes: pngBytes },
      );

      expect(valid.statusCode).toBe(201);
      expect(foreign.statusCode).toBe(404);
      expect(terminal.statusCode).toBe(409);
      expect(terminal.json()).toEqual({
        message: 'Inspection is completed',
      });
      expect(closedParent.statusCode).toBe(409);
      expect(closedParent.json()).toEqual({
        message: 'Work order is closed',
      });
    });

    it('authorizes InspectionItems through their Inspection', async () => {
      const tenantA = await createTenant('item-media-a');
      const tenantB = await createTenant('item-media-b');
      const workOrderA = await createWorkOrder(tenantA);
      const first = await createInspection(tenantA, workOrderA.id, {
        withItem: true,
      });
      const second = await createInspection(tenantA, workOrderA.id, {
        withItem: true,
      });
      const itemId = first.items[0]!.id;
      const valid = await upload(
        tenantA,
        `/api/inspections/${first.id}/items/${itemId}/media`,
        { bytes: webpBytes },
      );
      const wrongParent = await upload(
        tenantA,
        `/api/inspections/${second.id}/items/${itemId}/media`,
        { bytes: webpBytes },
      );
      const foreign = await upload(
        tenantB,
        `/api/inspections/${first.id}/items/${itemId}/media`,
        { bytes: webpBytes },
      );
      await prisma.inspection.update({
        where: { id: first.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedByMembershipId: tenantA.membershipId,
        },
      });
      const completed = await upload(
        tenantA,
        `/api/inspections/${first.id}/items/${itemId}/media`,
        { bytes: webpBytes },
      );

      expect(valid.statusCode).toBe(201);
      expect(wrongParent.statusCode).toBe(404);
      expect(wrongParent.json()).toEqual({
        message: 'Inspection item not found',
      });
      expect(foreign.statusCode).toBe(404);
      expect(completed.statusCode).toBe(409);
      expect(completed.json()).toEqual({
        message: 'Inspection is completed',
      });
    });

    it('prevents deleting an InspectionItem that has Media', async () => {
      const tenant = await createTenant('item-delete-media');
      const workOrder = await createWorkOrder(tenant);
      const inspection = await createInspection(tenant, workOrder.id, {
        withItem: true,
      });
      const itemId = inspection.items[0]!.id;
      await upload(
        tenant,
        `/api/inspections/${inspection.id}/items/${itemId}/media`,
        { bytes: jpegBytes },
      );
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/inspections/${inspection.id}/items/${itemId}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        message: 'Inspection item has media',
      });
      await expect(
        prisma.inspectionItem.findUnique({ where: { id: itemId } }),
      ).resolves.not.toBeNull();
    });
  });

  describe('metadata, content, caption, and deletion', () => {
    it('returns safe metadata and authenticated content headers', async () => {
      const tenant = await createTenant('content');
      const workOrder = await createWorkOrder(tenant);
      const uploadResponse = await uploadToWorkOrder(tenant, workOrder.id, {
        bytes: pngBytes,
        filename: 'evidence.png',
      });
      const media = uploadResponse.json<PublicMedia>();
      const metadata = await app.inject({
        method: 'GET',
        url: `/api/media/${media.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });
      const content = await app.inject({
        method: 'GET',
        url: `/api/media/${media.id}/content`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(metadata.statusCode).toBe(200);
      expect(metadata.json()).not.toHaveProperty('storageKey');
      expect(metadata.json()).not.toHaveProperty('sha256');
      expect(content.statusCode).toBe(200);
      expect(content.rawPayload).toEqual(pngBytes);
      expect(content.headers['content-type']).toBe('image/png');
      expect(content.headers['content-length']).toBe(String(pngBytes.length));
      expect(content.headers['x-content-type-options']).toBe('nosniff');
      expect(content.headers['cache-control']).toBe('private, no-store');
      expect(content.headers['content-disposition']).toContain('inline');
    });

    it('hides metadata and content cross-tenant or when missing', async () => {
      const tenantA = await createTenant('content-scope-a');
      const tenantB = await createTenant('content-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const media = (
        await uploadToWorkOrder(tenantA, workOrderA.id, { bytes: jpegBytes })
      ).json<PublicMedia>();

      for (const url of [
        `/api/media/${media.id}`,
        `/api/media/${media.id}/content`,
      ]) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: headers(tenantB.accessToken, tenantB.organizationId),
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ message: 'Media not found' });
      }

      const missing = await app.inject({
        method: 'GET',
        url: `/api/media/${randomUUID()}/content`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });
      expect(missing.statusCode).toBe(404);
    });

    it('updates only caption while the parent is mutable', async () => {
      const tenant = await createTenant('caption');
      const workOrder = await createWorkOrder(tenant);
      const media = (
        await uploadToWorkOrder(tenant, workOrder.id, { bytes: jpegBytes })
      ).json<PublicMedia>();
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/media/${media.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { caption: '  Updated caption  ' },
      });
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/media/${media.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { caption: 'Allowed', storageKey: 'forbidden' },
      });
      await prisma.workOrder.update({
        where: { id: workOrder.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const closed = await app.inject({
        method: 'PATCH',
        url: `/api/media/${media.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
        payload: { caption: 'Blocked' },
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ caption: 'Updated caption' });
      expect(invalid.statusCode).toBe(400);
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toEqual({ message: 'Work order is closed' });
    });

    it('deletes metadata and physical content', async () => {
      const tenant = await createTenant('delete');
      const workOrder = await createWorkOrder(tenant);
      const media = (
        await uploadToWorkOrder(tenant, workOrder.id, { bytes: jpegBytes })
      ).json<PublicMedia>();
      const stored = await prisma.media.findUniqueOrThrow({
        where: { id: media.id },
        select: { storageKey: true },
      });
      const storedPath = path.resolve(storageRoot, stored.storageKey);
      await expect(filesystem.stat(storedPath)).resolves.toBeTruthy();

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/media/${media.id}`,
        headers: headers(tenant.accessToken, tenant.organizationId),
      });

      expect(response.statusCode).toBe(204);
      await expect(
        prisma.media.findUnique({ where: { id: media.id } }),
      ).resolves.toBeNull();
      await expect(filesystem.stat(storedPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('hides cross-tenant deletion and blocks closed parents', async () => {
      const tenantA = await createTenant('delete-scope-a');
      const tenantB = await createTenant('delete-scope-b');
      const workOrderA = await createWorkOrder(tenantA);
      const media = (
        await uploadToWorkOrder(tenantA, workOrderA.id, { bytes: jpegBytes })
      ).json<PublicMedia>();
      const foreign = await app.inject({
        method: 'DELETE',
        url: `/api/media/${media.id}`,
        headers: headers(tenantB.accessToken, tenantB.organizationId),
      });
      await prisma.workOrder.update({
        where: { id: workOrderA.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      const closed = await app.inject({
        method: 'DELETE',
        url: `/api/media/${media.id}`,
        headers: headers(tenantA.accessToken, tenantA.organizationId),
      });

      expect(foreign.statusCode).toBe(404);
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toEqual({ message: 'Work order is closed' });
      await expect(
        prisma.media.findUnique({ where: { id: media.id } }),
      ).resolves.not.toBeNull();
    });
  });

  describe('failure cleanup and request security', () => {
    it('deletes a saved file best-effort when the DB insert fails', async () => {
      const tenant = await createTenant('db-cleanup');
      const workOrder = await createWorkOrder(tenant);
      await prisma.media.create({
        data: {
          organizationId: tenant.organizationId,
          workOrderId: workOrder.id,
          storageKey: 'duplicate-storage-key',
          originalName: 'existing.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: jpegBytes.length,
          sha256: createHash('sha256').update(jpegBytes).digest('hex'),
          uploadedByMembershipId: tenant.membershipId,
        },
      });

      const deletedKeys: string[] = [];
      const fakeStorage: MediaStorage = {
        async save(): Promise<SavedMediaFile> {
          return {
            storageKey: 'duplicate-storage-key',
            mimeType: 'image/jpeg',
            sizeBytes: jpegBytes.length,
            sha256: createHash('sha256').update(jpegBytes).digest('hex'),
          };
        },
        async open(): Promise<OpenedMediaFile> {
          throw new Error('Not used');
        },
        async delete(storageKey: string): Promise<void> {
          deletedKeys.push(storageKey);
        },
        async exists(): Promise<boolean> {
          return true;
        },
      };

      await expect(
        uploadMedia(
          tenant.organizationId,
          tenant.membershipId,
          { kind: 'WORK_ORDER', workOrderId: workOrder.id },
          {
            source: Readable.from(jpegBytes),
            originalName: 'duplicate.jpg',
            resolveCaption: () => undefined,
            isTruncated: () => false,
          },
          fakeStorage,
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(deletedKeys).toEqual(['duplicate-storage-key']);
    });

    it('requires auth/context and rejects tenant multipart fields', async () => {
      const tenant = await createTenant('request-security');
      const workOrder = await createWorkOrder(tenant);
      const multipart = multipartPayload({ bytes: jpegBytes });
      const anonymous = await app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/media`,
        headers: { 'content-type': multipart.contentType },
        payload: multipart.payload,
      });
      const missingContext = await app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/media`,
        headers: {
          authorization: `Bearer ${tenant.accessToken}`,
          'content-type': multipart.contentType,
        },
        payload: multipart.payload,
      });
      const injected = await uploadToWorkOrder(tenant, workOrder.id, {
        bytes: jpegBytes,
        fields: { organizationId: tenant.organizationId },
      });

      expect(anonymous.statusCode).toBe(401);
      expect(missingContext.statusCode).toBe(400);
      expect(injected.statusCode).toBe(400);
      await expect(prisma.media.count()).resolves.toBe(0);
    });
  });
});
