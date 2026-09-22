import 'dotenv/config';

import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../modules/auth/auth.password.js';
import {
  initialPasswordSchema,
  normalizedEmailSchema,
} from '../modules/auth/auth.schemas.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1] !== undefined) {
    return process.argv[index + 1];
  }
  return undefined;
}

function usageError(): never {
  throw new Error(
    'Usage: npm run user:reset-password -- --email user@example.com --password "NEW_PASSWORD"',
  );
}

async function main() {
  const rawEmail = readArg('--email');
  const rawPassword = readArg('--password');

  if (rawEmail === undefined || rawPassword === undefined) {
    usageError();
  }

  const emailResult = normalizedEmailSchema.safeParse(rawEmail);
  if (!emailResult.success) {
    console.error('Invalid email address.');
    process.exitCode = 1;
    return;
  }

  const passwordResult = initialPasswordSchema.safeParse(rawPassword);
  if (!passwordResult.success) {
    console.error(
      'Password must be between 10 and 128 characters (same rules as registration).',
    );
    process.exitCode = 1;
    return;
  }

  const email = emailResult.data;
  const password = passwordResult.data;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (existing === null) {
    console.error(`No user found for email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();

  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });

    await transaction.authSession.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: {
        revokedAt: now,
        revokedReason: 'operator_password_reset',
      },
    });

    await transaction.refreshToken.updateMany({
      where: {
        session: { userId: existing.id },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  });

  console.log(`Password reset for ${existing.email}.`);
}

void main()
  .catch((error: unknown) => {
    if (error instanceof Error && error.message.startsWith('Usage:')) {
      console.error(error.message);
    } else {
      console.error('Password reset failed.');
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
