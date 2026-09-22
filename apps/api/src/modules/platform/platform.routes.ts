import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  listPlatformOrganizationsQuerySchema,
  platformOrganizationIdParamsSchema,
  updatePlatformOrganizationBodySchema,
} from './platform.schemas.js';
import {
  PlatformOrganizationNotFoundError,
  activatePlatformOrganization,
  deactivatePlatformOrganization,
  getPlatformOrganizationById,
  listPlatformOrganizations,
  updatePlatformOrganization,
} from './platform.service.js';

function sendPlatformError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof PlatformOrganizationNotFoundError) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  request.log.error(error);
  return reply.code(500).send({ message: 'Internal server error' });
}

export async function registerPlatformRoutes(
  app: FastifyInstance,
): Promise<void> {
  const platformGuard = [app.authenticate, app.requirePlatformAdmin];

  app.get(
    '/api/platform/organizations',
    { preHandler: platformGuard },
    async (request, reply) => {
      const parsedQuery = listPlatformOrganizationsQuerySchema.safeParse(
        request.query,
      );
      if (!parsedQuery.success) {
        return reply.code(400).send({ message: 'Invalid query' });
      }

      try {
        return reply.code(200).send(
          await listPlatformOrganizations(parsedQuery.data),
        );
      } catch (error) {
        return sendPlatformError(request, reply, error);
      }
    },
  );

  app.get(
    '/api/platform/organizations/:organizationId',
    { preHandler: platformGuard },
    async (request, reply) => {
      const parsedParams = platformOrganizationIdParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }

      try {
        const organization = await getPlatformOrganizationById(
          parsedParams.data.organizationId,
        );
        if (organization === null) {
          return reply.code(404).send({ message: 'Organization not found' });
        }
        return reply.code(200).send(organization);
      } catch (error) {
        return sendPlatformError(request, reply, error);
      }
    },
  );

  app.post(
    '/api/platform/organizations/:organizationId/deactivate',
    { preHandler: platformGuard },
    async (request, reply) => {
      const parsedParams = platformOrganizationIdParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }

      try {
        return reply.code(200).send(
          await deactivatePlatformOrganization(
            parsedParams.data.organizationId,
          ),
        );
      } catch (error) {
        return sendPlatformError(request, reply, error);
      }
    },
  );

  app.post(
    '/api/platform/organizations/:organizationId/activate',
    { preHandler: platformGuard },
    async (request, reply) => {
      const parsedParams = platformOrganizationIdParamsSchema.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }

      try {
        return reply.code(200).send(
          await activatePlatformOrganization(parsedParams.data.organizationId),
        );
      } catch (error) {
        return sendPlatformError(request, reply, error);
      }
    },
  );

  app.patch(
    '/api/platform/organizations/:organizationId',
    { preHandler: platformGuard },
    async (request, reply) => {
      const parsedParams = platformOrganizationIdParamsSchema.safeParse(
        request.params,
      );
      const parsedBody = updatePlatformOrganizationBodySchema.safeParse(
        request.body,
      );
      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }
      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      try {
        return reply.code(200).send(
          await updatePlatformOrganization(
            parsedParams.data.organizationId,
            parsedBody.data,
          ),
        );
      } catch (error) {
        return sendPlatformError(request, reply, error);
      }
    },
  );
}
