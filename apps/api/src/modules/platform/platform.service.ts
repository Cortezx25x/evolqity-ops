import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type { ListPlatformOrganizationsQuery } from './platform.schemas.js';

export class PlatformOrganizationNotFoundError extends Error {
  constructor() {
    super('Organization not found');
    this.name = 'PlatformOrganizationNotFoundError';
  }
}

const ownerUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

async function findPrimaryOwner(organizationId: string) {
  const membership = await prisma.organizationUser.findFirst({
    where: {
      organizationId,
      role: 'OWNER',
      active: true,
      user: { active: true },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      user: { select: ownerUserSelect },
    },
  });

  return membership?.user ?? null;
}

async function countActiveMembers(organizationId: string) {
  return prisma.organizationUser.count({
    where: {
      organizationId,
      active: true,
      user: { active: true },
    },
  });
}

function buildOrganizationWhere(
  query: ListPlatformOrganizationsQuery,
): Prisma.OrganizationWhereInput {
  const where: Prisma.OrganizationWhereInput = {};

  if (query.status === 'active') {
    where.active = true;
  } else if (query.status === 'inactive') {
    where.active = false;
  }

  if (query.search !== undefined) {
    where.name = {
      contains: query.search,
      mode: 'insensitive',
    };
  }

  return where;
}

export async function listPlatformOrganizations(
  query: ListPlatformOrganizationsQuery,
) {
  const where = buildOrganizationWhere(query);

  const [organizations, total] = await prisma.$transaction([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        name: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.organization.count({ where }),
  ]);

  const rows = await Promise.all(
    organizations.map(async (organization) => ({
      ...organization,
      owner: await findPrimaryOwner(organization.id),
      activeMemberCount: await countActiveMembers(organization.id),
    })),
  );

  return {
    data: rows,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getPlatformOrganizationById(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (organization === null) {
    return null;
  }

  const [owner, activeMemberCount, inactiveMemberCount] = await Promise.all([
    findPrimaryOwner(organizationId),
    prisma.organizationUser.count({
      where: { organizationId, active: true, user: { active: true } },
    }),
    prisma.organizationUser.count({
      where: { organizationId, active: false },
    }),
  ]);

  return {
    ...organization,
    owner,
    activeMemberCount,
    inactiveMemberCount,
  };
}

export async function deactivatePlatformOrganization(organizationId: string) {
  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, active: true },
  });

  if (existing === null) {
    throw new PlatformOrganizationNotFoundError();
  }

  if (!existing.active) {
    return getPlatformOrganizationById(organizationId);
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { active: false },
  });

  return getPlatformOrganizationById(organizationId);
}

export async function activatePlatformOrganization(organizationId: string) {
  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, active: true },
  });

  if (existing === null) {
    throw new PlatformOrganizationNotFoundError();
  }

  if (existing.active) {
    return getPlatformOrganizationById(organizationId);
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { active: true },
  });

  return getPlatformOrganizationById(organizationId);
}

export async function updatePlatformOrganization(
  organizationId: string,
  input: { name: string },
) {
  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, active: true },
  });

  if (existing === null) {
    throw new PlatformOrganizationNotFoundError();
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { name: input.name },
  });

  return getPlatformOrganizationById(organizationId);
}

export async function grantPlatformAdminByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.update({
    where: { email: normalized },
    data: { platformRole: 'PLATFORM_ADMIN' },
    select: { id: true, email: true },
  });
  return user;
}

export async function revokePlatformAdminByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.update({
    where: { email: normalized },
    data: { platformRole: null },
    select: { id: true, email: true },
  });
  return user;
}
