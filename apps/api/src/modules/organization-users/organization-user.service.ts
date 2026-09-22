import type { OrganizationRole } from '../../generated/prisma/enums.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../auth/auth.password.js';
import type { OrganizationRequestContext } from '../organizations/organization.service.js';
import type {
  CreateOrganizationMemberBody,
  ProvisionOrganizationMemberBody,
} from './organization-user.schemas.js';

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

export class ProvisionUserEmailExistsError extends Error {
  constructor() {
    super('Ya existe una cuenta con este correo.');
    this.name = 'ProvisionUserEmailExistsError';
  }
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super('Miembro no encontrado.');
    this.name = 'MembershipNotFoundError';
  }
}

export class ManageMembershipForbiddenError extends Error {
  constructor() {
    super('No tienes permisos para administrar este empleado.');
    this.name = 'ManageMembershipForbiddenError';
  }
}

export class MembershipLifecycleError extends Error {
  constructor() {
    super('No se puede realizar esta acción con este miembro.');
    this.name = 'MembershipLifecycleError';
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

const publicMembershipSelect = {
  id: true,
  role: true,
  active: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
} as const;

function assertCanManageMembershipLifecycle(
  context: OrganizationRequestContext,
  target: { id: string; role: OrganizationRole },
): void {
  if (context.membershipId === target.id) {
    throw new MembershipLifecycleError();
  }

  if (target.role === 'OWNER') {
    throw new MembershipLifecycleError();
  }

  if (context.role === 'MEMBER') {
    throw new ManageMembershipForbiddenError();
  }

  if (context.role === 'ADMIN' && target.role !== 'MEMBER') {
    throw new ManageMembershipForbiddenError();
  }
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

export async function provisionOrganizationMember(
  context: OrganizationRequestContext,
  input: ProvisionOrganizationMemberBody,
) {
  if (
    context.role === 'MEMBER' ||
    input.role === 'OWNER' ||
    (context.role === 'ADMIN' && input.role !== 'MEMBER')
  ) {
    throw new ForbiddenOrganizationActionError();
  }

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          passwordHash,
        },
        select: { id: true },
      });

      return transaction.organizationUser.create({
        data: {
          organizationId: context.organizationId,
          userId: user.id,
          role: input.role,
        },
        select: publicMembershipSelect,
      });
    });
  } catch (error) {
    if (isMembershipUniqueViolation(error)) {
      throw new ProvisionUserEmailExistsError();
    }

    throw error;
  }
}

export async function listOrganizationMembers(
  context: OrganizationRequestContext,
) {
  return prisma.organizationUser.findMany({
    where: {
      organizationId: context.organizationId,
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    select: publicMembershipSelect,
  });
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
    select: publicMembershipSelect,
  });
}

async function setOrganizationMembershipActive(
  context: OrganizationRequestContext,
  membershipId: string,
  active: boolean,
) {
  const target = await prisma.organizationUser.findFirst({
    where: {
      id: membershipId,
      organizationId: context.organizationId,
    },
    select: { id: true, role: true, active: true },
  });

  if (target === null) {
    throw new MembershipNotFoundError();
  }

  assertCanManageMembershipLifecycle(context, target);

  if (target.active === active) {
    return prisma.organizationUser.findUniqueOrThrow({
      where: { id: membershipId },
      select: publicMembershipSelect,
    });
  }

  return prisma.organizationUser.update({
    where: { id: membershipId },
    data: { active },
    select: publicMembershipSelect,
  });
}

export async function deactivateOrganizationMember(
  context: OrganizationRequestContext,
  membershipId: string,
) {
  return setOrganizationMembershipActive(context, membershipId, false);
}

export async function activateOrganizationMember(
  context: OrganizationRequestContext,
  membershipId: string,
) {
  return setOrganizationMembershipActive(context, membershipId, true);
}
