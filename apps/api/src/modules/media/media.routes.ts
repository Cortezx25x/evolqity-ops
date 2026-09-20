import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import { env } from '../../config/env.js';
import {
  mediaIdParamsSchema,
  mediaInspectionItemParamsSchema,
  mediaInspectionParamsSchema,
  mediaWorkOrderParamsSchema,
  updateMediaBodySchema,
} from './media.schemas.js';
import {
  InvalidMediaMembershipError,
  InvalidMediaMultipartFieldsError,
  MediaFileTooLargeError,
  MediaInspectionCompletedError,
  MediaInspectionItemNotFoundError,
  MediaInspectionNotFoundError,
  MediaNotFoundError,
  MediaWorkOrderClosedError,
  MediaWorkOrderNotFoundError,
  deleteMedia,
  getMediaMetadata,
  listMediaForParent,
  openMediaContent,
  updateMediaCaption,
  uploadMedia,
  type MediaParent,
} from './media.service.js';
import { UnsupportedMediaTypeError } from './storage/media-storage.js';

function knownMediaError(error: unknown) {
  if (error instanceof MediaWorkOrderNotFoundError) {
    return { statusCode: 404, message: 'Work order not found' };
  }
  if (error instanceof MediaWorkOrderClosedError) {
    return { statusCode: 409, message: 'Work order is closed' };
  }
  if (error instanceof MediaInspectionNotFoundError) {
    return { statusCode: 404, message: 'Inspection not found' };
  }
  if (error instanceof MediaInspectionCompletedError) {
    return { statusCode: 409, message: 'Inspection is completed' };
  }
  if (error instanceof MediaInspectionItemNotFoundError) {
    return { statusCode: 404, message: 'Inspection item not found' };
  }
  if (error instanceof MediaNotFoundError) {
    return { statusCode: 404, message: 'Media not found' };
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return { statusCode: 415, message: 'Unsupported media type' };
  }
  if (error instanceof MediaFileTooLargeError) {
    return { statusCode: 413, message: 'File too large' };
  }
  if (error instanceof InvalidMediaMultipartFieldsError) {
    return { statusCode: 400, message: 'Invalid multipart fields' };
  }
  if (error instanceof InvalidMediaMembershipError) {
    return { statusCode: 403, message: 'Forbidden' };
  }

  return null;
}

function safeMediaErrorLog(request: FastifyRequest, error: unknown): void {
  request.log.error(
    {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    },
    'Media operation failed',
  );
}

function resolveMultipartCaption(fields: Record<string, unknown>): unknown {
  const unexpectedField = Object.keys(fields).find(
    (fieldName) => fieldName !== 'caption' && fieldName !== 'file',
  );

  if (unexpectedField !== undefined) {
    throw new InvalidMediaMultipartFieldsError();
  }

  const caption = fields.caption;
  if (caption === undefined) {
    return undefined;
  }
  if (
    Array.isArray(caption) ||
    typeof caption !== 'object' ||
    caption === null ||
    !('type' in caption) ||
    caption.type !== 'field' ||
    !('value' in caption) ||
    typeof caption.value !== 'string' ||
    ('valueTruncated' in caption && caption.valueTruncated === true)
  ) {
    throw new InvalidMediaMultipartFieldsError();
  }

  return caption.value;
}

async function uploadForParent(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  parent: MediaParent,
) {
  if (request.organizationContext === null) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  if (!request.isMultipart()) {
    return reply.code(400).send({ message: 'Multipart request required' });
  }

  try {
    const file = await request.file({
      limits: {
        fileSize: env.MEDIA_MAX_FILE_SIZE_BYTES,
        files: 1,
        fields: 1,
        parts: 2,
      },
      throwFileSizeLimit: true,
    });

    if (file === undefined || file.fieldname !== 'file') {
      return reply.code(400).send({ message: 'File is required' });
    }

    const media = await uploadMedia(
      request.organizationContext.organizationId,
      request.organizationContext.membershipId,
      parent,
      {
        source: file.file,
        originalName: file.filename,
        resolveCaption: () =>
          resolveMultipartCaption(file.fields as Record<string, unknown>),
        isTruncated: () => file.file.truncated,
      },
    );

    return reply.code(201).send(media);
  } catch (error) {
    if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
      return reply.code(413).send({ message: 'File too large' });
    }
    if (
      error instanceof app.multipartErrors.PartsLimitError ||
      error instanceof app.multipartErrors.FilesLimitError ||
      error instanceof app.multipartErrors.FieldsLimitError
    ) {
      return reply.code(400).send({ message: 'Invalid multipart fields' });
    }

    const knownError = knownMediaError(error);
    if (knownError !== null) {
      return reply
        .code(knownError.statusCode)
        .send({ message: knownError.message });
    }

    safeMediaErrorLog(request, error);
    return reply.code(500).send({ message: 'Internal server error' });
  }
}

async function sendKnownOrInternalError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  const knownError = knownMediaError(error);
  if (knownError !== null) {
    return reply
      .code(knownError.statusCode)
      .send({ message: knownError.message });
  }

  safeMediaErrorLog(request, error);
  return reply.code(500).send({ message: 'Internal server error' });
}

export async function registerMediaRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantContext = [app.authenticate, app.requireOrganizationContext];

  app.post(
    '/api/work-orders/:workOrderId/media',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaWorkOrderParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }

      return uploadForParent(app, request, reply, {
        kind: 'WORK_ORDER',
        workOrderId: parsedParams.data.workOrderId,
      });
    },
  );

  app.post(
    '/api/inspections/:inspectionId/media',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaInspectionParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection id' });
      }

      return uploadForParent(app, request, reply, {
        kind: 'INSPECTION',
        inspectionId: parsedParams.data.inspectionId,
      });
    },
  );

  app.post(
    '/api/inspections/:inspectionId/items/:itemId/media',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaInspectionItemParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection item id' });
      }

      return uploadForParent(app, request, reply, {
        kind: 'INSPECTION_ITEM',
        inspectionId: parsedParams.data.inspectionId,
        itemId: parsedParams.data.itemId,
      });
    },
  );

  app.get(
    '/api/work-orders/:workOrderId/media',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaWorkOrderParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid work order id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await listMediaForParent(
            request.organizationContext.organizationId,
            {
              kind: 'WORK_ORDER',
              workOrderId: parsedParams.data.workOrderId,
            },
          ),
        );
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/inspections/:inspectionId/media',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaInspectionParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await listMediaForParent(
            request.organizationContext.organizationId,
            {
              kind: 'INSPECTION',
              inspectionId: parsedParams.data.inspectionId,
            },
          ),
        );
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/inspections/:inspectionId/items/:itemId/media',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaInspectionItemParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid inspection item id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return reply.code(200).send(
          await listMediaForParent(
            request.organizationContext.organizationId,
            {
              kind: 'INSPECTION_ITEM',
              inspectionId: parsedParams.data.inspectionId,
              itemId: parsedParams.data.itemId,
            },
          ),
        );
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/media/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid media id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const media = await getMediaMetadata(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );
        if (media === null) {
          return reply.code(404).send({ message: 'Media not found' });
        }

        return reply.code(200).send(media);
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/media/:id/content',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid media id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const content = await openMediaContent(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );
        const fallbackName = content.originalName
          .replace(/["\\\r\n]/g, '_')
          .replace(/[^\x20-\x7E]/g, '_');

        return reply
          .header('Content-Type', content.mimeType)
          .header('Content-Length', String(content.sizeBytes))
          .header(
            'Content-Disposition',
            `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(content.originalName)}`,
          )
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'private, no-store')
          .send(content.stream);
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );

  app.patch(
    '/api/media/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaIdParamsSchema.safeParse(request.params);
      const parsedBody = updateMediaBodySchema.safeParse(request.body);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid media id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const media = await updateMediaCaption(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          parsedBody.data,
        );
        if (media === null) {
          return reply.code(404).send({ message: 'Media not found' });
        }

        return reply.code(200).send(media);
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );

  app.delete(
    '/api/media/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = mediaIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid media id' });
      }
      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const result = await deleteMedia(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );
        if (result.storageDeleteFailed) {
          request.log.warn(
            { mediaId: parsedParams.data.id },
            'Media metadata deleted but storage cleanup failed',
          );
        }

        return reply.code(204).send();
      } catch (error) {
        return sendKnownOrInternalError(request, reply, error);
      }
    },
  );
}
