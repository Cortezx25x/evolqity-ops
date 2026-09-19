import type { FastifyInstance } from 'fastify';

import { createUserBodySchema, userIdParamsSchema } from './user.schemas.js';
import {
  UserEmailExistsError,
  createUser,
  getUserById,
} from './user.service.js';

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/users', async (request, reply) => {
    const parsedBody = createUserBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      request.log.warn(
        { issues: parsedBody.error.issues },
        'Invalid create user body',
      );

      return reply.code(400).send({ message: 'Invalid request body' });
    }

    try {
      const user = await createUser(parsedBody.data);

      return reply.code(201).send(user);
    } catch (error) {
      if (error instanceof UserEmailExistsError) {
        return reply.code(409).send({
          message: 'User email already exists',
        });
      }

      request.log.error(error);

      return reply.code(500).send({ message: 'Internal server error' });
    }
  });

  app.get('/api/users/:id', async (request, reply) => {
    const parsedParams = userIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return reply.code(400).send({ message: 'Invalid user id' });
    }

    try {
      const user = await getUserById(parsedParams.data.id);

      if (user === null) {
        return reply.code(404).send({ message: 'User not found' });
      }

      return reply.code(200).send(user);
    } catch (error) {
      request.log.error(error);

      return reply.code(500).send({ message: 'Internal server error' });
    }
  });
}
