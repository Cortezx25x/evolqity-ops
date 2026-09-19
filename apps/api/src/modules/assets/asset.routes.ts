import type { FastifyInstance } from 'fastify';

import {
  assetIdParamsSchema,
  createAssetBodySchema,
  listAssetsQuerySchema,
  updateAssetBodySchema,
} from './asset.schemas.js';
import {
  InvalidAssetCustomerError,
  createAsset,
  getAssetById,
  listAssets,
  setAssetActive,
  updateAsset,
} from './asset.service.js';

export async function registerAssetRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantContext = [app.authenticate, app.requireOrganizationContext];

  app.post(
    '/api/assets',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedBody = createAssetBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const asset = await createAsset(
          request.organizationContext.organizationId,
          parsedBody.data,
        );

        return reply.code(201).send(asset);
      } catch (error) {
        if (error instanceof InvalidAssetCustomerError) {
          return reply.code(400).send({ message: 'Invalid customer' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/assets',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedQuery = listAssetsQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return reply.code(400).send({ message: 'Invalid query parameters' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const result = await listAssets(
          request.organizationContext.organizationId,
          parsedQuery.data,
        );

        return reply.code(200).send(result);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/assets/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = assetIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid asset id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const asset = await getAssetById(
          request.organizationContext.organizationId,
          parsedParams.data.id,
        );

        if (asset === null) {
          return reply.code(404).send({ message: 'Asset not found' });
        }

        return reply.code(200).send(asset);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.patch(
    '/api/assets/:id',
    { preHandler: tenantContext },
    async (request, reply) => {
      const parsedParams = assetIdParamsSchema.safeParse(request.params);
      const parsedBody = updateAssetBodySchema.safeParse(request.body);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid asset id' });
      }

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const asset = await updateAsset(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          parsedBody.data,
        );

        if (asset === null) {
          return reply.code(404).send({ message: 'Asset not found' });
        }

        return reply.code(200).send(asset);
      } catch (error) {
        if (error instanceof InvalidAssetCustomerError) {
          return reply.code(400).send({ message: 'Invalid customer' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/assets/:id/deactivate',
    {
      preHandler: [
        ...tenantContext,
        app.requireOrganizationRoles('OWNER', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const parsedParams = assetIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid asset id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const asset = await setAssetActive(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          false,
        );

        if (asset === null) {
          return reply.code(404).send({ message: 'Asset not found' });
        }

        return reply.code(200).send(asset);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/assets/:id/activate',
    {
      preHandler: [
        ...tenantContext,
        app.requireOrganizationRoles('OWNER', 'ADMIN'),
      ],
    },
    async (request, reply) => {
      const parsedParams = assetIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid asset id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const asset = await setAssetActive(
          request.organizationContext.organizationId,
          parsedParams.data.id,
          true,
        );

        if (asset === null) {
          return reply.code(404).send({ message: 'Asset not found' });
        }

        return reply.code(200).send(asset);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
