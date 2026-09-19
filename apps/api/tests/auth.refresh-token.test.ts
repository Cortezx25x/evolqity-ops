import { describe, expect, it } from 'vitest';

import {
  generateRefreshToken,
  generateRefreshTokenSecret,
  hashRefreshTokenSecret,
  parseRefreshToken,
  verifyRefreshTokenSecret,
} from '../src/modules/auth/auth.tokens.js';

describe('refresh tokens', () => {
  it('generates and parses an opaque token containing its ID and secret', () => {
    const generated = generateRefreshToken();

    expect(generated.token).toBe(`${generated.tokenId}.${generated.secret}`);
    expect(parseRefreshToken(generated.token)).toEqual({
      tokenId: generated.tokenId,
      secret: generated.secret,
    });
  });

  it('rejects malformed tokens', () => {
    expect(parseRefreshToken('invalid-token')).toBeNull();
    expect(parseRefreshToken('not-a-uuid.invalid-secret')).toBeNull();
  });

  it('verifies a matching secret hash', () => {
    const secret = generateRefreshTokenSecret();
    const tokenHash = hashRefreshTokenSecret(secret);

    expect(verifyRefreshTokenSecret(secret, tokenHash)).toBe(true);
  });

  it('rejects a different secret', () => {
    const secret = generateRefreshTokenSecret();
    const otherSecret = generateRefreshTokenSecret();
    const tokenHash = hashRefreshTokenSecret(secret);

    expect(verifyRefreshTokenSecret(otherSecret, tokenHash)).toBe(false);
  });
});
