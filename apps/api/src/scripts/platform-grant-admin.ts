import 'dotenv/config';

import { prisma } from '../lib/prisma.js';
import { grantPlatformAdminByEmail } from '../modules/platform/platform.service.js';

function readEmailArg(): string {
  const dashIndex = process.argv.indexOf('--email');
  if (dashIndex !== -1 && process.argv[dashIndex + 1] !== undefined) {
    return process.argv[dashIndex + 1]!;
  }

  const positional = process.argv[2];
  if (positional !== undefined && !positional.startsWith('-')) {
    return positional;
  }

  throw new Error(
    'Usage: npm run platform:grant-admin -- --email admin@example.com',
  );
}

async function main() {
  const email = readEmailArg().trim().toLowerCase();

  if (email.length === 0) {
    throw new Error('Email is required.');
  }

  try {
    const user = await grantPlatformAdminByEmail(email);
    console.log(`Platform admin granted to ${user.email} (${user.id}).`);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2025'
    ) {
      console.error(`No user found for email ${email}.`);
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
