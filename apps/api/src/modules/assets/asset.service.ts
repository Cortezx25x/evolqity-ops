import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateAssetBody,
  ListAssetsQuery,
  UpdateAssetBody,
} from './asset.schemas.js';

export class InvalidAssetCustomerError extends Error {
  constructor() {
    super('Invalid customer');
    this.name = 'InvalidAssetCustomerError';
  }
}

const customerSummarySelect = {
  id: true,
  name: true,
  type: true,
} as const;

const publicAssetSelect = {
  id: true,
  type: true,
  name: true,
  identifier: true,
  plate: true,
  vin: true,
  serialNumber: true,
  make: true,
  model: true,
  year: true,
  color: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: customerSummarySelect },
} as const;

async function customerIsActiveInOrganization(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
): Promise<boolean> {
  const customer = await transaction.customer.findFirst({
    where: {
      id: customerId,
      organizationId,
      active: true,
    },
    select: { id: true },
  });

  return customer !== null;
}

export async function createAsset(
  organizationId: string,
  input: CreateAssetBody,
) {
  return prisma.$transaction(async (transaction) => {
    if (
      !(await customerIsActiveInOrganization(
        transaction,
        organizationId,
        input.customerId,
      ))
    ) {
      throw new InvalidAssetCustomerError();
    }

    return transaction.asset.create({
      data: {
        organizationId,
        customerId: input.customerId,
        type: input.type,
        name: input.name,
        identifier: input.identifier ?? null,
        plate: input.plate ?? null,
        vin: input.vin ?? null,
        serialNumber: input.serialNumber ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        color: input.color ?? null,
        notes: input.notes ?? null,
      },
      select: publicAssetSelect,
    });
  });
}

export async function listAssets(
  organizationId: string,
  query: ListAssetsQuery,
) {
  const where: Prisma.AssetWhereInput = {
    organizationId,
    active: query.active,
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.customerId === undefined
      ? {}
      : { customerId: query.customerId }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { identifier: { contains: query.search, mode: 'insensitive' } },
            { plate: { contains: query.search, mode: 'insensitive' } },
            { vin: { contains: query.search, mode: 'insensitive' } },
            {
              serialNumber: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            { make: { contains: query.search, mode: 'insensitive' } },
            { model: { contains: query.search, mode: 'insensitive' } },
            {
              customer: {
                is: {
                  organizationId,
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
            },
          ],
        }),
  };
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
      select: publicAssetSelect,
    }),
    prisma.asset.count({ where }),
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

export async function getAssetById(
  organizationId: string,
  assetId: string,
) {
  return prisma.asset.findFirst({
    where: {
      id: assetId,
      organizationId,
    },
    select: publicAssetSelect,
  });
}

export async function updateAsset(
  organizationId: string,
  assetId: string,
  input: UpdateAssetBody,
) {
  return prisma.$transaction(async (transaction) => {
    const existingAsset = await transaction.asset.findFirst({
      where: {
        id: assetId,
        organizationId,
      },
      select: { id: true },
    });

    if (existingAsset === null) {
      return null;
    }

    if (
      input.customerId !== undefined &&
      !(await customerIsActiveInOrganization(
        transaction,
        organizationId,
        input.customerId,
      ))
    ) {
      throw new InvalidAssetCustomerError();
    }

    const data: Prisma.AssetUncheckedUpdateManyInput = {};

    if (input.customerId !== undefined) data.customerId = input.customerId;
    if (input.type !== undefined) data.type = input.type;
    if (input.name !== undefined) data.name = input.name;
    if (input.identifier !== undefined) data.identifier = input.identifier;
    if (input.plate !== undefined) data.plate = input.plate;
    if (input.vin !== undefined) data.vin = input.vin;
    if (input.serialNumber !== undefined) {
      data.serialNumber = input.serialNumber;
    }
    if (input.make !== undefined) data.make = input.make;
    if (input.model !== undefined) data.model = input.model;
    if (input.year !== undefined) data.year = input.year;
    if (input.color !== undefined) data.color = input.color;
    if (input.notes !== undefined) data.notes = input.notes;

    const result = await transaction.asset.updateMany({
      where: {
        id: assetId,
        organizationId,
      },
      data,
    });

    if (result.count !== 1) {
      return null;
    }

    return transaction.asset.findFirst({
      where: {
        id: assetId,
        organizationId,
      },
      select: publicAssetSelect,
    });
  });
}

export async function setAssetActive(
  organizationId: string,
  assetId: string,
  active: boolean,
) {
  const result = await prisma.asset.updateMany({
    where: {
      id: assetId,
      organizationId,
    },
    data: { active },
  });

  if (result.count !== 1) {
    return null;
  }

  return getAssetById(organizationId, assetId);
}
