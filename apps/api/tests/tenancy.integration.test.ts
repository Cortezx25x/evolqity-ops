import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type { OrganizationRole } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';

interface TenantIdentity {
  userId: string;
  organizationId: string;
  membershipId: string;
  accessToken: string;
}

function authHeaders(
  accessToken: string,
  organizationId?: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(organizationId === undefined
      ? {}
      : { 'x-organization-id': organizationId }),
  };
}

describe('multitenant isolation', () => {
  let app: FastifyInstance;
  let sequence = 0;

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
  }

  async function createAuthenticatedUser(
    prefix: string,
  ): Promise<{ userId: string; accessToken: string }> {
    const user = await prisma.user.create({
      data: { email: `${unique(prefix)}@example.com` },
      select: { id: true },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });

    return {
      userId: user.id,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function createOrganization(
    prefix: string,
    active = true,
  ): Promise<string> {
    const organization = await prisma.organization.create({
      data: {
        name: `${prefix} Organization`,
        slug: unique(prefix),
        active,
      },
      select: { id: true },
    });

    return organization.id;
  }

  async function createTenantIdentity(
    prefix: string,
    role: OrganizationRole = 'OWNER',
  ): Promise<TenantIdentity> {
    const authenticatedUser = await createAuthenticatedUser(prefix);
    const organizationId = await createOrganization(prefix);
    const membership = await prisma.organizationUser.create({
      data: {
        userId: authenticatedUser.userId,
        organizationId,
        role,
      },
      select: { id: true },
    });

    return {
      ...authenticatedUser,
      organizationId,
      membershipId: membership.id,
    };
  }

  async function addMembership(
    userId: string,
    organizationId: string,
    role: OrganizationRole,
    active = true,
  ): Promise<string> {
    const membership = await prisma.organizationUser.create({
      data: { userId, organizationId, role, active },
      select: { id: true },
    });

    return membership.id;
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

  describe('organizations', () => {
    it('lists only active organizations with active memberships', async () => {
      const userA = await createTenantIdentity('user-a');
      const userB = await createTenantIdentity('user-b');
      const inactiveOrganizationId = await createOrganization(
        'inactive-org',
        false,
      );
      const inactiveMembershipOrganizationId =
        await createOrganization('inactive-membership');
      await addMembership(
        userA.userId,
        inactiveOrganizationId,
        'MEMBER',
      );
      await addMembership(
        userA.userId,
        inactiveMembershipOrganizationId,
        'MEMBER',
        false,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/organizations',
        headers: authHeaders(userA.accessToken),
      });
      const organizations = response.json<
        Array<{ id: string; membershipId: string; role: string }>
      >();

      expect(response.statusCode).toBe(200);
      expect(organizations).toEqual([
        expect.objectContaining({
          id: userA.organizationId,
          membershipId: userA.membershipId,
          role: 'OWNER',
        }),
      ]);
      expect(organizations.map(({ id }) => id)).not.toContain(
        userB.organizationId,
      );
      expect(organizations.map(({ id }) => id)).not.toContain(
        inactiveOrganizationId,
      );
      expect(organizations.map(({ id }) => id)).not.toContain(
        inactiveMembershipOrganizationId,
      );
    });

    it('allows a user with two memberships to list both organizations', async () => {
      const organizationA = await createOrganization('organization-a');
      const organizationB = await createOrganization('organization-b');
      const userC = await createAuthenticatedUser('user-c');
      await addMembership(userC.userId, organizationA, 'ADMIN');
      await addMembership(userC.userId, organizationB, 'MEMBER');

      const response = await app.inject({
        method: 'GET',
        url: '/api/organizations',
        headers: authHeaders(userC.accessToken),
      });

      expect(
        response
          .json<Array<{ id: string }>>()
          .map(({ id }) => id)
          .sort(),
      ).toEqual([organizationA, organizationB].sort());
    });

    it('forbids reading another organization by ID', async () => {
      const userA = await createTenantIdentity('user-a');
      const userB = await createTenantIdentity('user-b');

      const response = await app.inject({
        method: 'GET',
        url: `/api/organizations/${userB.organizationId}`,
        headers: authHeaders(userA.accessToken),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ message: 'Forbidden' });
    });

    it('creates an additional organization and OWNER membership atomically', async () => {
      const userA = await createTenantIdentity('user-a');
      const slug = unique('additional-org');
      const response = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: authHeaders(userA.accessToken),
        payload: { name: 'Additional Organization', slug },
      });
      const body = response.json<{
        id: string;
        membershipId: string;
        role: string;
      }>();

      expect(response.statusCode).toBe(201);
      expect(body.role).toBe('OWNER');
      await expect(
        prisma.organizationUser.findUnique({
          where: { id: body.membershipId },
        }),
      ).resolves.toMatchObject({
        organizationId: body.id,
        userId: userA.userId,
        role: 'OWNER',
      });

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: authHeaders(userA.accessToken),
        payload: { name: 'Duplicate', slug },
      });
      expect(duplicate.statusCode).toBe(409);
    });
  });

  describe('organization selection and context', () => {
    it('selects an active organization belonging to the user', async () => {
      const userA = await createTenantIdentity('user-a');
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/select-organization',
        headers: authHeaders(userA.accessToken),
        payload: { organizationId: userA.organizationId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        organization: expect.objectContaining({ id: userA.organizationId }),
        membership: {
          id: userA.membershipId,
          role: 'OWNER',
        },
      });
    });

    it('rejects another, inactive, or inactive-membership organization', async () => {
      const userA = await createTenantIdentity('user-a');
      const userB = await createTenantIdentity('user-b');
      const inactiveOrganizationId = await createOrganization(
        'inactive-org',
        false,
      );
      const inactiveMembershipOrganizationId =
        await createOrganization('inactive-membership');
      await addMembership(
        userA.userId,
        inactiveOrganizationId,
        'MEMBER',
      );
      await addMembership(
        userA.userId,
        inactiveMembershipOrganizationId,
        'MEMBER',
        false,
      );

      for (const organizationId of [
        userB.organizationId,
        inactiveOrganizationId,
        inactiveMembershipOrganizationId,
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/select-organization',
          headers: authHeaders(userA.accessToken),
          payload: { organizationId },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ message: 'Forbidden' });
      }
    });

    it('returns the validated current context', async () => {
      const userA = await createTenantIdentity('user-a');
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/context',
        headers: authHeaders(userA.accessToken, userA.organizationId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        organization: expect.objectContaining({ id: userA.organizationId }),
        membership: {
          id: userA.membershipId,
          role: 'OWNER',
        },
      });
    });

    it('requires a valid organization context header', async () => {
      const userA = await createTenantIdentity('user-a');
      const missing = await app.inject({
        method: 'GET',
        url: '/api/auth/context',
        headers: authHeaders(userA.accessToken),
      });
      const invalid = await app.inject({
        method: 'GET',
        url: '/api/auth/context',
        headers: authHeaders(userA.accessToken, 'not-a-uuid'),
      });

      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({
        message: 'Organization context required',
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({
        message: 'Invalid organization context',
      });
    });

    it('rejects manually changing the header to another tenant', async () => {
      const userA = await createTenantIdentity('user-a');
      const userB = await createTenantIdentity('user-b');
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/context',
        headers: authHeaders(userA.accessToken, userB.organizationId),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ message: 'Forbidden' });
    });
  });

  describe('memberships and role guards', () => {
    it('allows an active MEMBER to list only members of its organization', async () => {
      const owner = await createTenantIdentity('owner');
      const member = await createAuthenticatedUser('member');
      await addMembership(member.userId, owner.organizationId, 'MEMBER');
      const outsider = await createTenantIdentity('outsider');

      const response = await app.inject({
        method: 'GET',
        url: `/api/organizations/${owner.organizationId}/members`,
        headers: authHeaders(member.accessToken, owner.organizationId),
      });

      expect(response.statusCode).toBe(200);
      expect(
        response
          .json<Array<{ user: { id: string } }>>()
          .map(({ user }) => user.id)
          .sort(),
      ).toEqual([owner.userId, member.userId].sort());
      expect(JSON.stringify(response.json())).not.toContain(outsider.userId);
    });

    it('forbids listing another organization and header/URL mismatches', async () => {
      const userA = await createTenantIdentity('user-a');
      const userB = await createTenantIdentity('user-b');
      const foreignHeader = await app.inject({
        method: 'GET',
        url: `/api/organizations/${userB.organizationId}/members`,
        headers: authHeaders(userA.accessToken, userB.organizationId),
      });
      const mismatchedUrl = await app.inject({
        method: 'GET',
        url: `/api/organizations/${userB.organizationId}/members`,
        headers: authHeaders(userA.accessToken, userA.organizationId),
      });

      expect(foreignHeader.statusCode).toBe(403);
      expect(mismatchedUrl.statusCode).toBe(403);
    });

    it.each(['MEMBER', 'ADMIN', 'OWNER'] as const)(
      'allows OWNER to add %s',
      async (targetRole) => {
        const owner = await createTenantIdentity('owner');
        const target = await createAuthenticatedUser('target');
        const response = await app.inject({
          method: 'POST',
          url: `/api/organizations/${owner.organizationId}/members`,
          headers: authHeaders(owner.accessToken, owner.organizationId),
          payload: { userId: target.userId, role: targetRole },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({
          organizationId: owner.organizationId,
          userId: target.userId,
          role: targetRole,
        });
      },
    );

    it.each(['MEMBER', 'ADMIN'] as const)(
      'allows ADMIN to add %s',
      async (targetRole) => {
        const owner = await createTenantIdentity('owner');
        const admin = await createAuthenticatedUser('admin');
        await addMembership(admin.userId, owner.organizationId, 'ADMIN');
        const target = await createAuthenticatedUser('target');
        const response = await app.inject({
          method: 'POST',
          url: `/api/organizations/${owner.organizationId}/members`,
          headers: authHeaders(admin.accessToken, owner.organizationId),
          payload: { userId: target.userId, role: targetRole },
        });

        expect(response.statusCode).toBe(201);
      },
    );

    it('forbids ADMIN from adding OWNER', async () => {
      const owner = await createTenantIdentity('owner');
      const admin = await createAuthenticatedUser('admin');
      await addMembership(admin.userId, owner.organizationId, 'ADMIN');
      const target = await createAuthenticatedUser('target');
      const response = await app.inject({
        method: 'POST',
        url: `/api/organizations/${owner.organizationId}/members`,
        headers: authHeaders(admin.accessToken, owner.organizationId),
        payload: { userId: target.userId, role: 'OWNER' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('forbids MEMBER from adding any user', async () => {
      const owner = await createTenantIdentity('owner');
      const member = await createAuthenticatedUser('member');
      await addMembership(member.userId, owner.organizationId, 'MEMBER');
      const target = await createAuthenticatedUser('target');
      const response = await app.inject({
        method: 'POST',
        url: `/api/organizations/${owner.organizationId}/members`,
        headers: authHeaders(member.accessToken, owner.organizationId),
        payload: { userId: target.userId, role: 'MEMBER' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('keeps duplicate membership conflicts and ignores body organizationId', async () => {
      const owner = await createTenantIdentity('owner');
      const otherTenant = await createTenantIdentity('other');
      const target = await createAuthenticatedUser('target');
      const first = await app.inject({
        method: 'POST',
        url: `/api/organizations/${owner.organizationId}/members`,
        headers: authHeaders(owner.accessToken, owner.organizationId),
        payload: {
          userId: target.userId,
          role: 'MEMBER',
          organizationId: otherTenant.organizationId,
        },
      });
      const duplicate = await app.inject({
        method: 'POST',
        url: `/api/organizations/${owner.organizationId}/members`,
        headers: authHeaders(owner.accessToken, owner.organizationId),
        payload: { userId: target.userId, role: 'MEMBER' },
      });

      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        organizationId: owner.organizationId,
      });
      expect(duplicate.statusCode).toBe(409);
      await expect(
        prisma.organizationUser.findUnique({
          where: {
            organizationId_userId: {
              organizationId: otherTenant.organizationId,
              userId: target.userId,
            },
          },
        }),
      ).resolves.toBeNull();
    });
  });

  describe('tenant-scoped users and public routes', () => {
    it('returns a user in the active tenant without sensitive fields', async () => {
      const owner = await createTenantIdentity('owner');
      const member = await createAuthenticatedUser('member');
      await addMembership(member.userId, owner.organizationId, 'MEMBER');

      const response = await app.inject({
        method: 'GET',
        url: `/api/users/${member.userId}`,
        headers: authHeaders(owner.accessToken, owner.organizationId),
      });
      const body = response.json<Record<string, unknown>>();

      expect(response.statusCode).toBe(200);
      expect(body.id).toBe(member.userId);
      expect(body).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('sessions');
      expect(body).not.toHaveProperty('refreshTokens');
    });

    it('forbids reading a user from another tenant', async () => {
      const userA = await createTenantIdentity('user-a');
      const userB = await createTenantIdentity('user-b');
      const response = await app.inject({
        method: 'GET',
        url: `/api/users/${userB.userId}`,
        headers: authHeaders(userA.accessToken, userA.organizationId),
      });

      expect(response.statusCode).toBe(403);
    });

    it('does not expose POST /api/users', async () => {
      const owner = await createTenantIdentity('owner');
      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: authHeaders(owner.accessToken, owner.organizationId),
        payload: { email: 'global-user@example.com' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('keeps me, auth lifecycle, health and ready free of tenant context', async () => {
      const owner = await createTenantIdentity('owner');
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authHeaders(owner.accessToken),
      });
      const register = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {},
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {},
      });
      const refresh = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
      });
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
      });
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      const ready = await app.inject({ method: 'GET', url: '/api/ready' });

      expect(me.statusCode).toBe(200);
      expect(register.statusCode).toBe(400);
      expect(login.statusCode).toBe(400);
      expect(refresh.statusCode).toBe(401);
      expect(logout.statusCode).toBe(204);
      expect(health.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
      expect(JSON.stringify(me.json())).not.toContain('passwordHash');
      expect(JSON.stringify(me.json())).not.toContain('AuthSession');
      expect(JSON.stringify(me.json())).not.toContain('RefreshToken');
    });

    it('allows X-Organization-Id in CORS preflight', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/auth/context',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'GET',
          'access-control-request-headers':
            'authorization,x-organization-id',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-headers']).toContain(
        'X-Organization-Id',
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });
});
