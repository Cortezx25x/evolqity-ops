import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateCustomerBody,
  ListCustomersQuery,
  UpdateCustomerBody,
} from './customer.schemas.js';

const publicCustomerSelect = {
  id: true,
  type: true,
  name: true,
  identification: true,
  email: true,
  phone: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createCustomer(
  organizationId: string,
  input: CreateCustomerBody,
) {
  return prisma.customer.create({
    data: {
      organizationId,
      type: input.type,
      name: input.name,
      identification: input.identification ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
    },
    select: publicCustomerSelect,
  });
}

export async function listCustomers(
  organizationId: string,
  query: ListCustomersQuery,
) {
  const where: Prisma.CustomerWhereInput = {
    organizationId,
    active: query.active,
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
            {
              identification: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ],
        }),
  };
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
      select: publicCustomerSelect,
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getCustomerById(
  organizationId: string,
  customerId: string,
) {
  return prisma.customer.findFirst({
    where: {
      id: customerId,
      organizationId,
    },
    select: publicCustomerSelect,
  });
}

export async function updateCustomer(
  organizationId: string,
  customerId: string,
  input: UpdateCustomerBody,
) {
  const data: Prisma.CustomerUpdateManyMutationInput = {};

  if (input.type !== undefined) data.type = input.type;
  if (input.name !== undefined) data.name = input.name;
  if (input.identification !== undefined) {
    data.identification = input.identification;
  }
  if (input.email !== undefined) data.email = input.email;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.notes !== undefined) data.notes = input.notes;

  const result = await prisma.customer.updateMany({
    where: {
      id: customerId,
      organizationId,
    },
    data,
  });

  if (result.count !== 1) {
    return null;
  }

  return getCustomerById(organizationId, customerId);
}

export async function setCustomerActive(
  organizationId: string,
  customerId: string,
  active: boolean,
) {
  const result = await prisma.customer.updateMany({
    where: {
      id: customerId,
      organizationId,
    },
    data: { active },
  });

  if (result.count !== 1) {
    return null;
  }

  return getCustomerById(organizationId, customerId);
}
