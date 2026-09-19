import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { z } from 'zod';

import type { OrganizationRole } from '../generated/prisma/enums.js';
import {
  resolveOrganizationContext,
  type OrganizationRequestContext,
} from '../modules/organizations/organization.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireOrganizationContext(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void>;
    requireOrganizationRoles(
      ...roles: OrganizationRole[]
    ): preHandlerHookHandler;
  }

  interface FastifyRequest {
    organizationContext: OrganizationRequestContext | null;
  }
}

const organizationIdSchema = z.uuid();

export async function registerOrganizationContextPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.decorateRequest('organizationContext', null);

  app.decorate(
    'requireOrganizationContext',
    async function requireOrganizationContext(request, reply): Promise<void> {
      const header = request.headers['x-organization-id'];

      if (header === undefined) {
        await reply
          .code(400)
          .send({ message: 'Organization context required' });
        return;
      }

      const parsedOrganizationId = organizationIdSchema.safeParse(header);

      if (!parsedOrganizationId.success) {
        await reply
          .code(400)
          .send({ message: 'Invalid organization context' });
        return;
      }

      if (request.auth === null) {
        await reply.code(401).send({ message: 'Unauthorized' });
        return;
      }

      try {
        const organizationContext = await resolveOrganizationContext(
          request.auth.userId,
          parsedOrganizationId.data,
        );

        if (organizationContext === null) {
          await reply.code(403).send({ message: 'Forbidden' });
          return;
        }

        request.organizationContext = organizationContext;
      } catch (error) {
        request.log.error(error);
        await reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.decorate(
    'requireOrganizationRoles',
    (...roles: OrganizationRole[]): preHandlerHookHandler =>
      async function requireOrganizationRole(request, reply): Promise<void> {
        if (
          request.organizationContext === null ||
          !roles.includes(request.organizationContext.role)
        ) {
          await reply.code(403).send({ message: 'Forbidden' });
        }
      },
  );
}
