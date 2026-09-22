import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import type { OrganizationRole } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/auth.tokens.js';
import { provisionOrganizationMember } from '../src/modules/organization-users/organization-user.service.js';

interface TenantIdentity {
  userId: string;
  organizationId: string;
  membershipId: string;
  accessToken: string;
  role: OrganizationRole;
}

describe('organization employee provisioning', () => {
  let app: FastifyInstance;
  let sequence = 0;

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}-${randomUUID().slice(0, 8)}`;
  }

  function headers(identity: TenantIdentity, organizationId?: string) {
    return {
      authorization: `Bearer ${identity.accessToken}`,
      'x-organization-id': organizationId ?? identity.organizationId,
    };
  }

  function provisionPayload(
    role: OrganizationRole = 'MEMBER',
    email = `${unique('employee')}@example.com`,
  ) {
    return {
      firstName: 'Juan',
      lastName: 'Perez',
      email,
      password: 'Initial password 2026!',
      role,
    };
  }

  async function createIdentity(
    prefix: string,
    role: OrganizationRole,
  ): Promise<TenantIdentity> {
    const user = await prisma.user.create({
      data: { email: `${unique(prefix)}@example.com` },
      select: { id: true },
    });
    const organization = await prisma.organization.create({
      data: {
        name: `${prefix} Organization`,
        slug: unique(`${prefix}-organization`),
      },
      select: { id: true },
    });
    const membership = await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role,
      },
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
      organizationId: organization.id,
      membershipId: membership.id,
      role,
      accessToken: signAccessToken(app.jwt, {
        userId: user.id,
        authSessionId: session.id,
      }),
    };
  }

  async function provision(
    identity: TenantIdentity,
    payload: Record<string, unknown>,
    urlOrganizationId = identity.organizationId,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/organizations/${urlOrganizationId}/members/provision`,
      headers: headers(identity),
      payload,
    });
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
    await prisma.estimatePublicToken.deleteMany();
    await prisma.media.deleteMany();
    await prisma.workOrder.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.organizationUser.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it.each(['MEMBER', 'ADMIN'] as const)(
    'allows OWNER to provision %s with a safe response',
    async (role) => {
      const owner = await createIdentity('owner', 'OWNER');
      const payload = provisionPayload(role, '  JUAN@EXAMPLE.COM ');
      const response = await provision(owner, payload);
      const body = response.json<{
        id: string;
        role: OrganizationRole;
        active: boolean;
        user: {
          id: string;
          firstName: string;
          lastName: string;
          email: string;
        };
      }>();

      expect(response.statusCode).toBe(201);
      expect(body).toEqual({
        id: expect.any(String),
        role,
        active: true,
        user: {
          id: expect.any(String),
          firstName: 'Juan',
          lastName: 'Perez',
          email: 'juan@example.com',
        },
      });
      expect(JSON.stringify(body)).not.toContain('password');
      expect(JSON.stringify(body)).not.toContain('passwordHash');

      const storedMembership =
        await prisma.organizationUser.findUniqueOrThrow({
          where: { id: body.id },
          include: { user: true },
        });
      expect(storedMembership.organizationId).toBe(owner.organizationId);
      expect(storedMembership.userId).toBe(body.user.id);
      expect(storedMembership.user.passwordHash).not.toBe(payload.password);
      expect(storedMembership.user.passwordHash).toContain(
        '$evolqity$argon2id$',
      );
    },
  );

  it('allows ADMIN to provision MEMBER', async () => {
    const admin = await createIdentity('admin', 'ADMIN');
    const response = await provision(admin, provisionPayload('MEMBER'));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ role: 'MEMBER', active: true });
  });

  it.each(['ADMIN', 'OWNER'] as const)(
    'forbids ADMIN from provisioning %s',
    async (role) => {
      const admin = await createIdentity('admin', 'ADMIN');
      const payload = provisionPayload(role);
      const response = await provision(admin, payload);

      expect(response.statusCode).toBe(403);
      await expect(
        prisma.user.findUnique({ where: { email: payload.email } }),
      ).resolves.toBeNull();
    },
  );

  it('forbids MEMBER from provisioning a user', async () => {
    const member = await createIdentity('member', 'MEMBER');
    const payload = provisionPayload();
    const response = await provision(member, payload);

    expect(response.statusCode).toBe(403);
    await expect(
      prisma.user.findUnique({ where: { email: payload.email } }),
    ).resolves.toBeNull();
  });

  it('forbids OWNER from provisioning OWNER', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const payload = provisionPayload('OWNER');
    const response = await provision(owner, payload);

    expect(response.statusCode).toBe(403);
    await expect(
      prisma.user.findUnique({ where: { email: payload.email } }),
    ).resolves.toBeNull();
  });

  it('returns a safe 409 for an existing normalized email', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const existing = await prisma.user.create({
      data: { email: 'existing@example.com' },
      select: { id: true },
    });
    const response = await provision(
      owner,
      provisionPayload('MEMBER', '  EXISTING@EXAMPLE.COM '),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: 'Ya existe una cuenta con este correo.',
    });
    await expect(
      prisma.organizationUser.findUnique({
        where: {
          organizationId_userId: {
            organizationId: owner.organizationId,
            userId: existing.id,
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it('rejects invalid passwords and prohibited fields', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const invalidPassword = await provision(owner, {
      ...provisionPayload(),
      password: 'short',
    });
    const prohibitedField = await provision(owner, {
      ...provisionPayload(),
      userId: randomUUID(),
    });

    expect(invalidPassword.statusCode).toBe(400);
    expect(prohibitedField.statusCode).toBe(400);
  });

  it('rejects a URL organization that differs from tenant context', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const otherTenant = await createIdentity('other', 'OWNER');
    const payload = provisionPayload();
    const response = await provision(
      owner,
      payload,
      otherTenant.organizationId,
    );

    expect(response.statusCode).toBe(403);
    await expect(
      prisma.user.findUnique({ where: { email: payload.email } }),
    ).resolves.toBeNull();
  });

  it('lets the provisioned user log in with the initial password', async () => {
    const owner = await createIdentity('owner', 'OWNER');
    const payload = provisionPayload();
    const created = await provision(owner, payload);

    expect(created.statusCode).toBe(201);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: payload.password },
    });
    const body = login.json<{
      user: { email: string };
      organizations: Array<{ id: string; role: OrganizationRole }>;
    }>();

    expect(login.statusCode).toBe(200);
    expect(body.user.email).toBe(payload.email);
    expect(body.organizations).toContainEqual(
      expect.objectContaining({
        id: owner.organizationId,
        role: 'MEMBER',
      }),
    );
  });

  it('rolls back user creation when membership creation fails', async () => {
    const email = `${unique('atomic')}@example.com`;

    await expect(
      provisionOrganizationMember(
        {
          organizationId: randomUUID(),
          membershipId: randomUUID(),
          role: 'OWNER',
        },
        provisionPayload('MEMBER', email),
      ),
    ).rejects.toBeDefined();

    await expect(
      prisma.user.findUnique({ where: { email } }),
    ).resolves.toBeNull();
  });
});
