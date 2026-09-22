import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { registerAssetRoutes } from './modules/assets/asset.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerCustomerRoutes } from './modules/customers/customer.routes.js';
import { registerEstimateRoutes } from './modules/estimates/estimate.routes.js';
import { registerPublicEstimateRoutes } from './modules/public-estimates/public-estimate.routes.js';
import { registerInspectionRoutes } from './modules/inspections/inspection.routes.js';
import { registerMediaRoutes } from './modules/media/media.routes.js';
import { registerOrganizationUserRoutes } from './modules/organization-users/organization-user.routes.js';
import { registerOrganizationRoutes } from './modules/organizations/organization.routes.js';
import { registerPlatformRoutes } from './modules/platform/platform.routes.js';
import { registerUserRoutes } from './modules/users/user.routes.js';
import { registerWorkOrderRoutes } from './modules/work-orders/work-order.routes.js';
import { registerAuthenticationPlugin } from './plugins/authentication.js';
import { registerOrganizationContextPlugin } from './plugins/organization-context.js';
import { registerPlatformAdminPlugin } from './plugins/platform-admin.js';

export interface BuildAppOptions {
  logger?: boolean;
}

const redactedLogPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'body.password',
  'body.passwordHash',
  'body.refreshToken',
  'body.accessToken',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.refreshToken',
  'req.body.accessToken',
];

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    logger:
      options.logger === false
        ? false
        : {
            redact: {
              paths: redactedLogPaths,
              censor: '[REDACTED]',
            },
          },
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;

    if (origin !== undefined && !env.CORS_ORIGINS.includes(origin)) {
      await reply.code(403).send({ message: 'Origin not allowed' });
    }
  });

  await app.register(cors, {
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Organization-Id',
    ],
    origin(origin, callback) {
      if (origin === undefined || env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: env.MEDIA_MAX_FILE_SIZE_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
    },
    throwFileSizeLimit: true,
  });
  await app.register(jwt, {
    secret: env.AUTH_ACCESS_TOKEN_SECRET,
    sign: {
      expiresIn: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      iss: env.AUTH_JWT_ISSUER,
      aud: env.AUTH_JWT_AUDIENCE,
    },
    verify: {
      allowedIss: env.AUTH_JWT_ISSUER,
      allowedAud: env.AUTH_JWT_AUDIENCE,
    },
  });
  await app.register(rateLimit, {
    global: false,
  });
  await registerAuthenticationPlugin(app);
  await registerOrganizationContextPlugin(app);
  await registerPlatformAdminPlugin(app);

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'evolqity-ops-api',
  }));

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

  await registerAuthRoutes(app);

  await registerOrganizationRoutes(app);
  await registerUserRoutes(app);
  await registerOrganizationUserRoutes(app);
  await registerCustomerRoutes(app);
  await registerAssetRoutes(app);
  await registerWorkOrderRoutes(app);
  await registerInspectionRoutes(app);
  await registerMediaRoutes(app);
  await registerEstimateRoutes(app);
  await registerPublicEstimateRoutes(app);
  await registerPlatformRoutes(app);

  return app;
}
