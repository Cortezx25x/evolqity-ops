import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePlatformAdmin(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void>;
  }
}

export async function registerPlatformAdminPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.decorate(
    'requirePlatformAdmin',
    async function requirePlatformAdmin(request, reply): Promise<void> {
      if (request.auth === null) {
        await reply.code(401).send({ message: 'Unauthorized' });
        return;
      }

      try {
        const user = await prisma.user.findFirst({
          where: {
            id: request.auth.userId,
            active: true,
            platformRole: 'PLATFORM_ADMIN',
          },
          select: { id: true },
        });

        if (user === null) {
          await reply.code(403).send({ message: 'Forbidden' });
          return;
        }
      } catch (error) {
        request.log.error(error);
        await reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
