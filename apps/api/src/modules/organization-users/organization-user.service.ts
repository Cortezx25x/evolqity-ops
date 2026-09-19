import { prisma } from '../../lib/prisma.js';
import type { OrganizationRequestContext } from '../organizations/organization.service.js';
import type { CreateOrganizationMemberBody } from './organization-user.schemas.js';

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

export class ForbiddenOrganizationActionError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenOrganizationActionError';
  }
}

function isMembershipUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function createOrganizationMember(
  context: OrganizationRequestContext,
  input: CreateOrganizationMemberBody,
) {
  if (
    context.role === 'MEMBER' ||
    (context.role === 'ADMIN' && input.role === 'OWNER')
  ) {
    throw new ForbiddenOrganizationActionError();
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
        organizationId: context.organizationId,
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
        organizationId: context.organizationId,
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

export async function listActiveOrganizationMembers(
  context: OrganizationRequestContext,
) {
  return prisma.organizationUser.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      user: { active: true },
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
