import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.password.js';
import type { AccessTokenClaims } from '../src/modules/auth/auth.types.js';

interface RegisterResult {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    type: string | null;
    role: string;
  }>;
}

interface RefreshResult {
  accessToken: string;
  expiresIn: number;
}

function authorization(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

function extractCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;

  if (cookieHeader === undefined) {
    throw new Error('Expected response to set a cookie.');
  }

  const cookie = cookieHeader.split(';')[0];

  if (cookie === undefined) {
    throw new Error('Invalid Set-Cookie header.');
  }

  return cookie;
}

function cookieValue(cookie: string): string {
  const separator = cookie.indexOf('=');

  if (separator < 0) {
    throw new Error('Invalid cookie.');
  }

  return cookie.slice(separator + 1);
}

describe('authentication API', () => {
  let app: FastifyInstance;
  let sequence = 0;

  function nextIdentity(prefix = 'auth') {
    sequence += 1;
    const suffix = `${sequence}-${randomUUID().slice(0, 8)}`;

    return {
      email: `${prefix}-${suffix}@example.com`,
      slug: `${prefix}-${suffix}`,
    };
  }

  async function registerUser(overrides: Record<string, unknown> = {}) {
    const identity = nextIdentity();
    const password = 'Valid password 2026!';
    const payload = {
      email: identity.email,
      password,
      firstName: 'Test',
      lastName: 'User',
      organizationName: 'Test Organization',
      organizationSlug: identity.slug,
      organizationType: 'test',
      ...overrides,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload,
    });

    return {
      response,
      payload,
      body: response.json<RegisterResult>(),
      cookie: response.statusCode === 201 ? extractCookie(response) : undefined,
    };
  }

  beforeAll(async () => {
    const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');

    if (!databaseName.endsWith('_test')) {
      throw new Error(
        'Integration tests refuse to run unless DATABASE_URL targets a *_test database.',
      );
    }

    app = await buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.organizationUser.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('register', () => {
    it('creates the user, organization, OWNER membership, session and secure response', async () => {
      const result = await registerUser({
        email: '  OWNER@EXAMPLE.COM ',
        organizationSlug: '  owner-org ',
      });

      expect(result.response.statusCode).toBe(201);
      expect(result.body.user.email).toBe('owner@example.com');
      expect(result.body.organizations).toEqual([
        expect.objectContaining({ slug: 'owner-org', role: 'OWNER' }),
      ]);
      expect(result.body.accessToken).toEqual(expect.any(String));
      expect(result.response.headers['set-cookie']).toContain('HttpOnly');
      expect(JSON.stringify(result.body)).not.toContain('passwordHash');
      expect(JSON.stringify(result.body)).not.toContain('tokenHash');
      expect(JSON.stringify(result.body)).not.toContain(
        cookieValue(result.cookie!),
      );

      const user = await prisma.user.findUnique({
        where: { email: 'owner@example.com' },
        include: {
          organizations: true,
          sessions: { include: { refreshTokens: true } },
        },
      });

      expect(user?.passwordHash).not.toBe(result.payload.password);
      expect(user?.passwordHash).toContain('$evolqity$argon2id$');
      expect(user?.organizations).toHaveLength(1);
      expect(user?.organizations[0]?.role).toBe('OWNER');
      expect(user?.sessions).toHaveLength(1);
      expect(user?.sessions[0]?.refreshTokens).toHaveLength(1);
    });

    it('returns 409 for a duplicate email', async () => {
      const first = await registerUser();
      const second = await registerUser({
        email: first.payload.email,
      });

      expect(second.response.statusCode).toBe(409);
      expect(second.response.json()).toEqual({
        message: 'User email already exists',
      });
    });

    it('returns 409 for a duplicate slug and rolls back the new user', async () => {
      const first = await registerUser();
      const duplicateEmail = nextIdentity('rollback').email;
      const second = await registerUser({
        email: duplicateEmail,
        organizationSlug: first.payload.organizationSlug,
      });

      expect(second.response.statusCode).toBe(409);
      expect(second.response.json()).toEqual({
        message: 'Organization slug already exists',
      });
      await expect(
        prisma.user.findUnique({ where: { email: duplicateEmail } }),
      ).resolves.toBeNull();
    });
  });

  describe('login', () => {
    it('creates a new session for valid credentials', async () => {
      const registered = await registerUser();
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: registered.payload.email,
          password: registered.payload.password,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<RegisterResult>().accessToken).toEqual(
        expect.any(String),
      );
      expect(response.headers['set-cookie']).toContain('HttpOnly');
      await expect(
        prisma.authSession.count({
          where: { userId: registered.body.user.id },
        }),
      ).resolves.toBe(2);
    });

    it('allows an active user with no organizations to log in', async () => {
      const identity = nextIdentity('no-organizations');
      const password = 'Valid password 2026!';
      await prisma.user.create({
        data: {
          email: identity.email,
          passwordHash: await hashPassword(password),
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: identity.email, password },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<RegisterResult>().organizations).toEqual([]);
    });

    it.each([
      ['incorrect password', 'existing'],
      ['unknown user', 'missing'],
      ['inactive user', 'inactive'],
      ['user without password', 'passwordless'],
    ])('returns the same 401 for %s', async (_label, scenario) => {
      const identity = nextIdentity('credentials');
      let email = identity.email;
      const password = 'Valid password 2026!';

      if (scenario === 'existing' || scenario === 'inactive') {
        await prisma.user.create({
          data: {
            email,
            passwordHash: await hashPassword(password),
            active: scenario !== 'inactive',
          },
        });
      } else if (scenario === 'passwordless') {
        await prisma.user.create({ data: { email } });
      } else {
        email = `missing-${identity.email}`;
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email,
          password:
            scenario === 'existing' ? 'Incorrect password 2026!' : password,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        message: 'Invalid email or password',
      });
    });
  });

  describe('refresh', () => {
    it('rotates tokens and allows the newly issued token', async () => {
      const registered = await registerUser();
      const oldCookie = registered.cookie!;
      const oldTokenId = cookieValue(oldCookie).split('.')[0]!;
      const firstRefresh = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: oldCookie },
      });
      const newCookie = extractCookie(firstRefresh);
      const newTokenId = cookieValue(newCookie).split('.')[0]!;

      expect(firstRefresh.statusCode).toBe(200);
      expect(newCookie).not.toBe(oldCookie);

      const oldToken = await prisma.refreshToken.findUniqueOrThrow({
        where: { id: oldTokenId },
      });
      expect(oldToken.usedAt).not.toBeNull();
      expect(oldToken.replacedByTokenId).toBe(newTokenId);

      const secondRefresh = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: newCookie },
      });
      expect(secondRefresh.statusCode).toBe(200);
    });

    it('treats reuse as replay and revokes the whole session', async () => {
      const registered = await registerUser();
      const oldCookie = registered.cookie!;
      const firstRefresh = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: oldCookie },
      });
      const newCookie = extractCookie(firstRefresh);
      const replay = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: oldCookie },
      });

      expect(replay.statusCode).toBe(401);
      expect(replay.headers['set-cookie']).toContain('Max-Age=0');

      const claims = app.jwt.decode<AccessTokenClaims>(
        firstRefresh.json<RefreshResult>().accessToken,
      );
      const session = await prisma.authSession.findUniqueOrThrow({
        where: { id: claims!.sid },
      });
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokedReason).toBe('refresh_token_replay');

      const newTokenAttempt = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: newCookie },
      });
      expect(newTokenAttempt.statusCode).toBe(401);
    });

    it('rejects an expired refresh token', async () => {
      const registered = await registerUser();
      const tokenId = cookieValue(registered.cookie!).split('.')[0]!;
      await prisma.refreshToken.update({
        where: { id: tokenId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: registered.cookie! },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a revoked session', async () => {
      const registered = await registerUser();
      const claims = app.jwt.decode<AccessTokenClaims>(
        registered.body.accessToken,
      );
      await prisma.authSession.update({
        where: { id: claims!.sid },
        data: { revokedAt: new Date(), revokedReason: 'test' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: registered.cookie! },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('logout', () => {
    it('clears the cookie, revokes the session, and remains idempotent', async () => {
      const registered = await registerUser();
      const claims = app.jwt.decode<AccessTokenClaims>(
        registered.body.accessToken,
      );
      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: registered.cookie! },
      });

      expect(first.statusCode).toBe(204);
      expect(first.headers['set-cookie']).toContain('Max-Age=0');

      const session = await prisma.authSession.findUniqueOrThrow({
        where: { id: claims!.sid },
      });
      expect(session.revokedAt).not.toBeNull();

      const activeTokens = await prisma.refreshToken.count({
        where: { sessionId: claims!.sid, revokedAt: null },
      });
      expect(activeTokens).toBe(0);

      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: registered.cookie! },
      });
      expect(second.statusCode).toBe(204);
    });
  });

  describe('me and access authentication', () => {
    it('returns the current user with multiple active organizations', async () => {
      const registered = await registerUser();
      const secondOrganization = await prisma.organization.create({
        data: { name: 'Second Organization', slug: nextIdentity('org').slug },
      });
      await prisma.organizationUser.create({
        data: {
          organizationId: secondOrganization.id,
          userId: registered.body.user.id,
          role: 'ADMIN',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authorization(registered.body.accessToken),
      });
      const body = response.json<{
        user: Record<string, unknown>;
        organizations: Array<Record<string, unknown>>;
      }>();

      expect(response.statusCode).toBe(200);
      expect(body.organizations).toHaveLength(2);
      expect(body.organizations[1]).toMatchObject({
        id: secondOrganization.id,
        role: 'ADMIN',
      });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      expect(JSON.stringify(body)).not.toContain('tokenHash');
    });

    it('filters inactive memberships and inactive organizations', async () => {
      const registered = await registerUser();
      const inactiveMembershipOrganization =
        await prisma.organization.create({
          data: {
            name: 'Inactive Membership',
            slug: nextIdentity('inactive-membership').slug,
          },
        });
      const inactiveOrganization = await prisma.organization.create({
        data: {
          name: 'Inactive Organization',
          slug: nextIdentity('inactive-org').slug,
          active: false,
        },
      });
      await prisma.organizationUser.createMany({
        data: [
          {
            organizationId: inactiveMembershipOrganization.id,
            userId: registered.body.user.id,
            role: 'MEMBER',
            active: false,
          },
          {
            organizationId: inactiveOrganization.id,
            userId: registered.body.user.id,
            role: 'MEMBER',
          },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authorization(registered.body.accessToken),
      });

      expect(response.json<{ organizations: unknown[] }>().organizations).toHaveLength(
        1,
      );
    });

    it('rejects an expired access token', async () => {
      const registered = await registerUser();
      const claims = app.jwt.decode<AccessTokenClaims>(
        registered.body.accessToken,
      )!;
      const expiredToken = app.jwt.sign(
        {
          sub: claims.sub,
          sid: claims.sid,
          typ: 'access',
          jti: randomUUID(),
        },
        {
          expiresIn: -1,
          iss: env.AUTH_JWT_ISSUER,
          aud: env.AUTH_JWT_AUDIENCE,
        },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authorization(expiredToken),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a revoked session immediately', async () => {
      const registered = await registerUser();
      const claims = app.jwt.decode<AccessTokenClaims>(
        registered.body.accessToken,
      )!;
      await prisma.authSession.update({
        where: { id: claims.sid },
        data: { revokedAt: new Date(), revokedReason: 'test' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authorization(registered.body.accessToken),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an inactive user immediately', async () => {
      const registered = await registerUser();
      await prisma.user.update({
        where: { id: registered.body.user.id },
        data: { active: false },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authorization(registered.body.accessToken),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('route and transport security', () => {
    it.each([
      ['GET', '/api/organizations'],
      ['POST', '/api/organizations'],
      ['GET', `/api/users/${randomUUID()}`],
      ['GET', `/api/organizations/${randomUUID()}/members`],
      ['POST', `/api/organizations/${randomUUID()}/members`],
    ])('rejects anonymous %s %s', async (method, url) => {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    });

    it('does not expose generic user creation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { email: 'unsafe@example.com' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('keeps health and readiness public', async () => {
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      const ready = await app.inject({ method: 'GET', url: '/api/ready' });

      expect(health.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
    });

    it('rejects origins outside the exact CORS allowlist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows configured origins and requests without Origin', async () => {
      const browser = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://localhost:5173' },
      });
      const cli = await app.inject({ method: 'GET', url: '/api/health' });

      expect(browser.statusCode).toBe(200);
      expect(browser.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(browser.headers['access-control-allow-credentials']).toBe('true');
      expect(cli.statusCode).toBe(200);
    });
  });
});
