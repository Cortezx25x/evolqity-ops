import type { FastifyInstance } from 'fastify';

import {
  createOrganizationBodySchema,
  organizationIdParamsSchema,
} from './organization.schemas.js';
import {
  OrganizationSlugExistsError,
  createOrganization,
  getOrganizationById,
  listActiveOrganizations,
} from './organization.service.js';

export async function registerOrganizationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post('/api/organizations', async (request, reply) => {
    const parsedBody = createOrganizationBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      request.log.warn(
        { issues: parsedBody.error.issues },
        'Invalid create organization body',
      );

      return reply.code(400).send({ message: 'Invalid request body' });
    }

    try {
      const organization = await createOrganization(parsedBody.data);

      return reply.code(201).send(organization);
    } catch (error) {
      if (error instanceof OrganizationSlugExistsError) {
        return reply.code(409).send({
          message: 'Organization slug already exists',
        });
      }

      request.log.error(error);

      return reply.code(500).send({ message: 'Internal server error' });
    }
  });

  app.get('/api/organizations', async (request, reply) => {
    try {
      const organizations = await listActiveOrganizations();

      return reply.code(200).send(organizations);
    } catch (error) {
      request.log.error(error);

      return reply.code(500).send({ message: 'Internal server error' });
    }
  });

  app.get('/api/organizations/:id', async (request, reply) => {
    const parsedParams = organizationIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return reply.code(400).send({ message: 'Invalid organization id' });
    }

    try {
      const organization = await getOrganizationById(parsedParams.data.id);

      if (organization === null) {
        return reply.code(404).send({ message: 'Organization not found' });
      }

      return reply.code(200).send(organization);
    } catch (error) {
      request.log.error(error);

      return reply.code(500).send({ message: 'Internal server error' });
    }
  });
}
