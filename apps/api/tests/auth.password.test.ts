import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  verifyPassword,
} from '../src/modules/auth/auth.password.js';

const password = 'Correct horse battery staple 2026!';

describe('password hashing', () => {
  it('creates a salted hash that verifies the original password', async () => {
    const storedHash = await hashPassword(password);

    expect(storedHash).not.toBe(password);
    await expect(verifyPassword(password, storedHash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const storedHash = await hashPassword(password);

    await expect(
      verifyPassword('Incorrect horse battery staple 2026!', storedHash),
    ).resolves.toBe(false);
  });

  it('produces different hashes for the same password', async () => {
    const [firstHash, secondHash] = await Promise.all([
      hashPassword(password),
      hashPassword(password),
    ]);

    expect(firstHash).not.toBe(secondHash);
  });

  it('rejects malformed stored hashes safely', async () => {
    await expect(verifyPassword(password, 'not-a-valid-hash')).resolves.toBe(
      false,
    );
  });
});
