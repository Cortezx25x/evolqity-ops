import { prisma } from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CreateOrganizationBody } from './organization.schemas.js';

export class OrganizationSlugExistsError extends Error {
  constructor() {
    super('Organization slug already exists');
    this.name = 'OrganizationSlugExistsError';
  }
}

function isSlugUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function createOrganization(input: CreateOrganizationBody) {
  try {
    return await prisma.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        type: input.type ?? null,
      },
    });
  } catch (error) {
    if (isSlugUniqueViolation(error)) {
      throw new OrganizationSlugExistsError();
    }

    throw error;
  }
}

export async function listActiveOrganizations() {
  return prisma.organization.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getOrganizationById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
  });
}
