import { prisma } from '../../lib/prisma.js';
import type { OrganizationRole } from '../../generated/prisma/enums.js';
import type { CreateOrganizationBody } from './organization.schemas.js';

export class OrganizationSlugExistsError extends Error {
  constructor() {
    super('Organization slug already exists');
    this.name = 'OrganizationSlugExistsError';
  }
}

function isSlugUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export interface OrganizationRequestContext {
  organizationId: string;
  membershipId: string;
  role: OrganizationRole;
}

const organizationSelection = {
  id: true,
  name: true,
  slug: true,
  type: true,
} as const;

export async function createOrganization(
  userId: string,
  input: CreateOrganizationBody,
) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          type: input.type ?? null,
        },
        select: organizationSelection,
      });
      const membership = await transaction.organizationUser.create({
        data: {
          organizationId: organization.id,
          userId,
          role: 'OWNER',
        },
        select: { id: true },
      });

      return {
        ...organization,
        membershipId: membership.id,
        role: 'OWNER' as const,
      };
    });
  } catch (error) {
    if (isSlugUniqueViolation(error)) {
      throw new OrganizationSlugExistsError();
    }

    throw error;
  }
}

export async function listActiveOrganizationsForUser(userId: string) {
  const memberships = await prisma.organizationUser.findMany({
    where: {
      userId,
      active: true,
      organization: { active: true },
    },
    orderBy: { organization: { name: 'asc' } },
    select: {
      id: true,
      role: true,
      organization: { select: organizationSelection },
    },
  });

  return memberships.map(({ id, role, organization }) => ({
    ...organization,
    role,
    membershipId: id,
  }));
}

export async function getOrganizationSelectionForUser(
  userId: string,
  organizationId: string,
) {
  const membership = await prisma.organizationUser.findFirst({
    where: {
      userId,
      organizationId,
      active: true,
      organization: { active: true },
    },
    select: {
      id: true,
      role: true,
      organization: { select: organizationSelection },
    },
  });

  if (membership === null) {
    return null;
  }

  return {
    organization: membership.organization,
    membership: {
      id: membership.id,
      role: membership.role,
    },
  };
}

export async function resolveOrganizationContext(
  userId: string,
  organizationId: string,
): Promise<OrganizationRequestContext | null> {
  const selection = await getOrganizationSelectionForUser(
    userId,
    organizationId,
  );

  if (selection === null) {
    return null;
  }

  return {
    organizationId: selection.organization.id,
    membershipId: selection.membership.id,
    role: selection.membership.role,
  };
}

export async function getOrganizationByIdForUser(
  userId: string,
  organizationId: string,
) {
  const selection = await getOrganizationSelectionForUser(
    userId,
    organizationId,
  );

  if (selection === null) {
    return null;
  }

  return {
    ...selection.organization,
    role: selection.membership.role,
    membershipId: selection.membership.id,
  };
}
