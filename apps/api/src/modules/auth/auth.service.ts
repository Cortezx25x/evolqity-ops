import { randomBytes } from 'node:crypto';

import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { getOrganizationSelectionForUser } from '../organizations/organization.service.js';
import {
  AuthEmailExistsError,
  AuthOrganizationSlugExistsError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReplayError,
} from './auth.errors.js';
import { hashPassword, verifyPassword } from './auth.password.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';
import {
  generateRefreshToken,
  hashRefreshTokenSecret,
  parseRefreshToken,
  verifyRefreshTokenSecret,
} from './auth.tokens.js';
import type {
  AuthOrganization,
  AuthRequestMetadata,
  AuthSessionResult,
  PublicAuthUser,
} from './auth.types.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const publicAuthUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

let dummyPasswordHashPromise: Promise<string> | undefined;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHashPromise ??= hashPassword(
    randomBytes(32).toString('base64url'),
  );

  return dummyPasswordHashPromise;
}

function getSessionExpiration(): Date {
  return new Date(
    Date.now() + env.AUTH_SESSION_TTL_DAYS * MILLISECONDS_PER_DAY,
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
}

async function createSessionWithRefreshToken(
  transaction: Prisma.TransactionClient,
  userId: string,
  metadata: AuthRequestMetadata,
) {
  const sessionExpiresAt = getSessionExpiration();
  const generatedToken = generateRefreshToken();

  const session = await transaction.authSession.create({
    data: {
      userId,
      expiresAt: sessionExpiresAt,
      userAgent: metadata.userAgent ?? null,
      createdIp: metadata.ip ?? null,
    },
    select: { id: true },
  });

  await transaction.refreshToken.create({
    data: {
      id: generatedToken.tokenId,
      sessionId: session.id,
      tokenHash: Uint8Array.from(
        hashRefreshTokenSecret(generatedToken.secret),
      ),
      expiresAt: sessionExpiresAt,
    },
  });

  return {
    sessionId: session.id,
    sessionExpiresAt,
    refreshToken: generatedToken.token,
  };
}

function mapMemberships(
  memberships: Array<{
    id: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    organization: {
      id: string;
      name: string;
      slug: string;
      type: string | null;
    };
  }>,
): AuthOrganization[] {
  return memberships.map(({ id, role, organization }) => ({
    membershipId: id,
    ...organization,
    role,
  }));
}

export async function register(
  input: RegisterBody,
  metadata: AuthRequestMetadata,
): Promise<AuthSessionResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
        },
        select: publicAuthUserSelect,
      });

      const organization = await transaction.organization.create({
        data: {
          name: input.organizationName,
          slug: input.organizationSlug,
          type: input.organizationType ?? null,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
        },
      });

      await transaction.organizationUser.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'OWNER',
        },
      });

      const session = await createSessionWithRefreshToken(
        transaction,
        user.id,
        metadata,
      );

      return {
        user,
        organizations: [{ ...organization, role: 'OWNER' }],
        ...session,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [emailExists, slugExists] = await Promise.all([
        prisma.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        }),
        prisma.organization.findUnique({
          where: { slug: input.organizationSlug },
          select: { id: true },
        }),
      ]);

      if (emailExists !== null) {
        throw new AuthEmailExistsError();
      }

      if (slugExists !== null) {
        throw new AuthOrganizationSlugExistsError();
      }
    }

    throw error;
  }
}

export async function login(
  input: LoginBody,
  metadata: AuthRequestMetadata,
): Promise<AuthSessionResult> {
  const [user, dummyPasswordHash] = await Promise.all([
    prisma.user.findUnique({
      where: { email: input.email },
      select: {
        ...publicAuthUserSelect,
        active: true,
        passwordHash: true,
        organizations: {
          where: {
            active: true,
            organization: { active: true },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                type: true,
              },
            },
          },
        },
      },
    }),
    getDummyPasswordHash(),
  ]);

  const hashToVerify =
    user?.passwordHash === null || user?.passwordHash === undefined
      ? dummyPasswordHash
      : user.passwordHash;
  const passwordMatches = await verifyPassword(input.password, hashToVerify);

  if (
    user === null ||
    !user.active ||
    user.passwordHash === null ||
    !passwordMatches
  ) {
    throw new InvalidCredentialsError();
  }

  const session = await prisma.$transaction((transaction) =>
    createSessionWithRefreshToken(transaction, user.id, metadata),
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    organizations: mapMemberships(user.organizations),
    ...session,
  };
}

async function revokeSession(
  sessionId: string,
  reason: string,
): Promise<void> {
  const now = new Date();

  await prisma.$transaction([
    prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    }),
    prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

export async function refreshSession(refreshToken: string) {
  const parsedToken = parseRefreshToken(refreshToken);

  if (parsedToken === null) {
    throw new InvalidRefreshTokenError();
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { id: parsedToken.tokenId },
    select: {
      tokenHash: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      session: {
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: { active: true } },
        },
      },
    },
  });

  if (
    storedToken === null ||
    !verifyRefreshTokenSecret(parsedToken.secret, storedToken.tokenHash)
  ) {
    throw new InvalidRefreshTokenError();
  }

  if (storedToken.usedAt !== null || storedToken.revokedAt !== null) {
    await revokeSession(storedToken.session.id, 'refresh_token_replay');
    throw new RefreshTokenReplayError();
  }

  const now = new Date();

  if (
    storedToken.expiresAt <= now ||
    storedToken.session.expiresAt <= now ||
    storedToken.session.revokedAt !== null ||
    !storedToken.session.user.active
  ) {
    throw new InvalidRefreshTokenError();
  }

  const generatedToken = generateRefreshToken();
  const newTokenHash = hashRefreshTokenSecret(generatedToken.secret);

  const rotation = await prisma.$transaction(async (transaction) => {
    const activeSession = await transaction.authSession.updateMany({
      where: {
        id: storedToken.session.id,
        userId: storedToken.session.userId,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { active: true },
      },
      data: { lastUsedAt: now },
    });

    if (activeSession.count !== 1) {
      return 'invalid' as const;
    }

    const claimedToken = await transaction.refreshToken.updateMany({
      where: {
        id: parsedToken.tokenId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (claimedToken.count !== 1) {
      await transaction.authSession.updateMany({
        where: { id: storedToken.session.id, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: 'refresh_token_replay',
        },
      });
      await transaction.refreshToken.updateMany({
        where: {
          sessionId: storedToken.session.id,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      return 'replay' as const;
    }

    await transaction.refreshToken.create({
      data: {
        id: generatedToken.tokenId,
        sessionId: storedToken.session.id,
        tokenHash: Uint8Array.from(newTokenHash),
        expiresAt: storedToken.session.expiresAt,
      },
    });

    await transaction.refreshToken.update({
      where: { id: parsedToken.tokenId },
      data: { replacedByTokenId: generatedToken.tokenId },
    });

    return 'rotated' as const;
  });

  if (rotation === 'replay') {
    throw new RefreshTokenReplayError();
  }

  if (rotation === 'invalid') {
    throw new InvalidRefreshTokenError();
  }

  return {
    userId: storedToken.session.userId,
    sessionId: storedToken.session.id,
    sessionExpiresAt: storedToken.session.expiresAt,
    refreshToken: generatedToken.token,
  };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (refreshToken === undefined) {
    return;
  }

  const parsedToken = parseRefreshToken(refreshToken);

  if (parsedToken === null) {
    return;
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { id: parsedToken.tokenId },
    select: {
      tokenHash: true,
      sessionId: true,
    },
  });

  if (
    storedToken === null ||
    !verifyRefreshTokenSecret(parsedToken.secret, storedToken.tokenHash)
  ) {
    return;
  }

  await revokeSession(storedToken.sessionId, 'logout');
}

export async function validateAccessSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const session = await prisma.authSession.findFirst({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { active: true },
    },
    select: { id: true },
  });

  return session !== null;
}

export async function getCurrentUser(userId: string): Promise<{
  user: PublicAuthUser;
  organizations: AuthOrganization[];
} | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, active: true },
    select: {
      ...publicAuthUserSelect,
      organizations: {
        where: {
          active: true,
          organization: { active: true },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              type: true,
            },
          },
        },
      },
    },
  });

  if (user === null) {
    return null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    organizations: mapMemberships(user.organizations),
  };
}

export async function selectOrganizationForUser(
  userId: string,
  organizationId: string,
) {
  return getOrganizationSelectionForUser(userId, organizationId);
}
