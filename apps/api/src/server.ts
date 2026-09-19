import 'dotenv/config';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';

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

  return app;
}

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
