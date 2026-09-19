import type { FastifyInstance } from 'fastify';

import { userIdParamsSchema } from './user.schemas.js';
import { getUserByIdInOrganization } from './user.service.js';

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/users/:id',
    {
      preHandler: [app.authenticate, app.requireOrganizationContext],
    },
    async (request, reply) => {
      const parsedParams = userIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({ message: 'Invalid user id' });
      }

      if (request.organizationContext === null) {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const user = await getUserByIdInOrganization(
          parsedParams.data.id,
          request.organizationContext.organizationId,
        );

        if (user === null) {
          return reply.code(403).send({ message: 'Forbidden' });
        }

        return reply.code(200).send(user);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
