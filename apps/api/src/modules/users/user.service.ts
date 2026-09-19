import { prisma } from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CreateUserBody } from './user.schemas.js';

export class UserEmailExistsError extends Error {
  constructor() {
    super('User email already exists');
    this.name = 'UserEmailExistsError';
  }
}

function isEmailUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function createUser(input: CreateUserBody) {
  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      },
    });
  } catch (error) {
    if (isEmailUniqueViolation(error)) {
      throw new UserEmailExistsError();
    }

    throw error;
  }
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
  });
}
