import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';
import type { AccessTokenClaims } from '../src/modules/auth/auth.types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const authSessionId = '22222222-2222-4222-8222-222222222222';

describe('access tokens', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(jwt, {
      secret: env.AUTH_ACCESS_TOKEN_SECRET,
      verify: {
        allowedIss: env.AUTH_JWT_ISSUER,
        allowedAud: env.AUTH_JWT_AUDIENCE,
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('contains only the expected authentication claims and expiration', () => {
    const token = signAccessToken(app.jwt, { userId, authSessionId });
    const claims = app.jwt.verify<AccessTokenClaims>(token);

    expect(claims.sub).toBe(userId);
    expect(claims.sid).toBe(authSessionId);
    expect(claims.typ).toBe('access');
    expect(claims.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(claims.iss).toBe(env.AUTH_JWT_ISSUER);
    expect(claims.aud).toBe(env.AUTH_JWT_AUDIENCE);
    expect(claims.exp - claims.iat).toBe(env.AUTH_ACCESS_TOKEN_TTL_SECONDS);
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('organizationId');
    expect(claims).not.toHaveProperty('roles');
  });
});
