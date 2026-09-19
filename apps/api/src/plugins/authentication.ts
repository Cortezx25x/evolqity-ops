import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import { validateAccessSession } from '../modules/auth/auth.service.js';
import type {
  AccessTokenClaims,
  AuthenticatedRequestContext,
} from '../modules/auth/auth.types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void>;
  }

  interface FastifyRequest {
    auth: AuthenticatedRequestContext | null;
  }
}

function hasValidAccessClaims(
  claims: Partial<AccessTokenClaims>,
): claims is AccessTokenClaims {
  return (
    claims.typ === 'access' &&
    typeof claims.sub === 'string' &&
    UUID_PATTERN.test(claims.sub) &&
    typeof claims.sid === 'string' &&
    UUID_PATTERN.test(claims.sid)
  );
}

export async function registerAuthenticationPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.decorateRequest('auth', null);

  app.decorate(
    'authenticate',
    async function authenticate(request, reply): Promise<void> {
      let claims: AccessTokenClaims;

      try {
        const verified = await request.jwtVerify<AccessTokenClaims>();

        if (!hasValidAccessClaims(verified)) {
          throw new Error('Invalid access token claims');
        }

        claims = verified;
      } catch {
        await reply.code(401).send({ message: 'Unauthorized' });
        return;
      }

      try {
        const sessionIsActive = await validateAccessSession(
          claims.sub,
          claims.sid,
        );

        if (!sessionIsActive) {
          await reply.code(401).send({ message: 'Unauthorized' });
          return;
        }

        request.auth = {
          userId: claims.sub,
          sessionId: claims.sid,
        };
      } catch (error) {
        request.log.error(error);
        await reply.code(500).send({ message: 'Internal server error' });
      }
    },
  );
}
