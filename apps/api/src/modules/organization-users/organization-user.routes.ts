import type { FastifyInstance } from 'fastify';

import {
  createOrganizationMemberBodySchema,
  organizationIdParamsSchema,
} from './organization-user.schemas.js';
import {
  ForbiddenOrganizationActionError,
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
    {
      preHandler: [
        app.authenticate,
        app.requireOrganizationContext,
        app.requireOrganizationRoles('OWNER', 'ADMIN'),
      ],
    },
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

      if (
        request.organizationContext === null ||
        parsedParams.data.organizationId !==
          request.organizationContext.organizationId
      ) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const membership = await createOrganizationMember(
          request.organizationContext,
          parsedBody.data,
        );

        return reply.code(201).send(membership);
      } catch (error) {
        if (error instanceof ForbiddenOrganizationActionError) {
          return reply.code(403).send({ message: 'Forbidden' });
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
    {
      preHandler: [app.authenticate, app.requireOrganizationContext],
    },
    async (request, reply) => {
      const parsedParams = organizationIdParamsSchema.safeParse(
        request.params,
      );

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid organization id' });
      }

      if (
        request.organizationContext === null ||
        parsedParams.data.organizationId !==
          request.organizationContext.organizationId
      ) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const members = await listActiveOrganizationMembers(
          request.organizationContext,
        );

        return reply.code(200).send(members);
      } catch (error) {
        request.log.error(error);

        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
