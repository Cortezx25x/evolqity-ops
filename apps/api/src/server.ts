import 'dotenv/config';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';

import { prisma } from './lib/prisma.js';
import { registerOrganizationUserRoutes } from './modules/organization-users/organization-user.routes.js';
import { registerOrganizationRoutes } from './modules/organizations/organization.routes.js';
import { registerUserRoutes } from './modules/users/user.routes.js';

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '127.0.0.1';

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid PORT environment variable: "${value}"`);
    process.exit(1);
  }

  return port;
}

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST ?? DEFAULT_HOST;

async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors);
  await app.register(helmet);

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'evolqity-ops-api',
  }));

  await registerOrganizationRoutes(app);
  await registerUserRoutes(app);
  await registerOrganizationUserRoutes(app);

  app.get('/api/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      return reply.code(200).send({
        status: 'ready',
        database: 'connected',
      });
    } catch (error) {
      app.log.error(error);

      return reply.code(503).send({
        status: 'not_ready',
        database: 'disconnected',
      });
    }
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

async function start() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);

    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
