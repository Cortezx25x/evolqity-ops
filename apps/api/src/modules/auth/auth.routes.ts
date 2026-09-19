import type { FastifyInstance, FastifyRequest } from 'fastify';

import { env } from '../../config/env.js';
import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from './auth.cookies.js';
import {
  AuthEmailExistsError,
  AuthOrganizationSlugExistsError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from './auth.errors.js';
import { loginBodySchema, registerBodySchema } from './auth.schemas.js';
import {
  getCurrentUser,
  login,
  logout,
  refreshSession,
  register,
} from './auth.service.js';
import { signAccessToken } from './auth.tokens.js';
import type { AuthSessionResult } from './auth.types.js';

const authRateLimit = {
  max: env.AUTH_LOGIN_RATE_LIMIT_MAX,
  timeWindow: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000,
};

function getRequestMetadata(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];

  return {
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ip: request.ip,
  };
}

function createSessionResponse(
  app: FastifyInstance,
  session: AuthSessionResult,
) {
  return {
    accessToken: signAccessToken(app.jwt, {
      userId: session.user.id,
      authSessionId: session.sessionId,
    }),
    expiresIn: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    user: session.user,
    organizations: session.organizations,
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/register',
    { config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const parsedBody = registerBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      try {
        const session = await register(
          parsedBody.data,
          getRequestMetadata(request),
        );

        setRefreshTokenCookie(
          reply,
          session.refreshToken,
          session.sessionExpiresAt,
        );

        return reply.code(201).send(createSessionResponse(app, session));
      } catch (error) {
        if (error instanceof AuthEmailExistsError) {
          return reply.code(409).send({ message: 'User email already exists' });
        }

        if (error instanceof AuthOrganizationSlugExistsError) {
          return reply
            .code(409)
            .send({ message: 'Organization slug already exists' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/auth/login',
    { config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const parsedBody = loginBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({ message: 'Invalid request body' });
      }

      try {
        const session = await login(
          parsedBody.data,
          getRequestMetadata(request),
        );

        setRefreshTokenCookie(
          reply,
          session.refreshToken,
          session.sessionExpiresAt,
        );

        return reply.code(200).send(createSessionResponse(app, session));
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return reply
            .code(401)
            .send({ message: 'Invalid email or password' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post(
    '/api/auth/refresh',
    { config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const refreshToken = request.cookies[env.AUTH_REFRESH_COOKIE_NAME];

      if (refreshToken === undefined) {
        clearRefreshTokenCookie(reply);
        return reply.code(401).send({ message: 'Invalid refresh token' });
      }

      try {
        const session = await refreshSession(refreshToken);
        const accessToken = signAccessToken(app.jwt, {
          userId: session.userId,
          authSessionId: session.sessionId,
        });

        setRefreshTokenCookie(
          reply,
          session.refreshToken,
          session.sessionExpiresAt,
        );

        return reply.code(200).send({
          accessToken,
          expiresIn: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
        });
      } catch (error) {
        clearRefreshTokenCookie(reply);

        if (error instanceof InvalidRefreshTokenError) {
          return reply.code(401).send({ message: 'Invalid refresh token' });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const refreshToken = request.cookies[env.AUTH_REFRESH_COOKIE_NAME];
    clearRefreshTokenCookie(reply);

    try {
      await logout(refreshToken);
    } catch (error) {
      request.log.error(error);
    }

    return reply.code(204).send();
  });

  app.get(
    '/api/auth/me',
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (request.auth === null) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      try {
        const currentUser = await getCurrentUser(request.auth.userId);

        if (currentUser === null) {
          return reply.code(401).send({ message: 'Unauthorized' });
        }

        return reply.code(200).send(currentUser);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
