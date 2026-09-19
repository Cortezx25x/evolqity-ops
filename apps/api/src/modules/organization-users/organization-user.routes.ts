import type { FastifyInstance } from 'fastify';

import {
  createOrganizationMemberBodySchema,
  organizationIdParamsSchema,
} from './organization-user.schemas.js';
import {
  OrganizationNotFoundError,
  UserAlreadyMemberError,
  UserNotFoundError,
  createOrganizationMember,
  listActiveOrganizationMembers,
} from './organization-user.service.js';

export async function registerOrganizationUserRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/api/organizations/:organizationId/members',
    async (request, reply) => {
      const parsedParams = organizationIdParamsSchema.safeParse(
        request.params,
      );

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }

      const parsedBody = createOrganizationMemberBodySchema.safeParse(
        request.body,
      );

      if (!parsedBody.success) {
        request.log.warn(
          { issues: parsedBody.error.issues },
          'Invalid create organization member body',
        );

        return reply.code(400).send({ message: 'Invalid request body' });
      }

      try {
        const membership = await createOrganizationMember(
          parsedParams.data.organizationId,
          parsedBody.data,
        );

        return reply.code(201).send(membership);
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          return reply.code(404).send({ message: 'Organization not found' });
        }

        if (error instanceof UserNotFoundError) {
          return reply.code(404).send({ message: 'User not found' });
        }

        if (error instanceof UserAlreadyMemberError) {
          return reply.code(409).send({
            message: 'User already belongs to organization',
          });
        }

        request.log.error(error);

        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.get(
    '/api/organizations/:organizationId/members',
    async (request, reply) => {
      const parsedParams = organizationIdParamsSchema.safeParse(
        request.params,
      );

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }

      try {
        const members = await listActiveOrganizationMembers(
          parsedParams.data.organizationId,
        );

        return reply.code(200).send(members);
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          return reply.code(404).send({ message: 'Organization not found' });
        }

        request.log.error(error);

        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
