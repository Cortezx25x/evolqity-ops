import { prisma } from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CreateOrganizationMemberBody } from './organization-user.schemas.js';

export class OrganizationNotFoundError extends Error {
  constructor() {
    super('Organization not found');
    this.name = 'OrganizationNotFoundError';
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export class UserAlreadyMemberError extends Error {
  constructor() {
    super('User already belongs to organization');
    this.name = 'UserAlreadyMemberError';
  }
}

function isMembershipUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function createOrganizationMember(
  organizationId: string,
  input: CreateOrganizationMemberBody,
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });

  if (organization === null) {
    throw new OrganizationNotFoundError();
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });

  if (user === null) {
    throw new UserNotFoundError();
  }

  const existingMembership = await prisma.organizationUser.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: input.userId,
      },
    },
    select: { id: true },
  });

  if (existingMembership !== null) {
    throw new UserAlreadyMemberError();
  }

  try {
    return await prisma.organizationUser.create({
      data: {
        organizationId,
        userId: input.userId,
        role: input.role,
      },
    });
  } catch (error) {
    if (isMembershipUniqueViolation(error)) {
      throw new UserAlreadyMemberError();
    }

    throw error;
  }
}

export async function listActiveOrganizationMembers(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });

  if (organization === null) {
    throw new OrganizationNotFoundError();
  }

  return prisma.organizationUser.findMany({
    where: {
      organizationId,
      active: true,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      active: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
}
