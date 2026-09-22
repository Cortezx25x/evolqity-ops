import { describe, expect, it } from 'vitest';

import { env } from '../src/config/env.js';
import {
  buildPublicEstimateAccessUrl,
  buildPublicEstimateToken,
  generatePublicEstimateToken,
  generatePublicEstimateTokenSecret,
  hashPublicEstimateTokenSecret,
  parseEstimateAuthorizationHeader,
  parsePublicEstimateToken,
  verifyPublicEstimateTokenSecret,
} from '../src/modules/public-estimates/public-estimate.tokens.js';
import { hashRefreshTokenSecret } from '../src/modules/auth/auth.tokens.js';

describe('public estimate tokens', () => {
  it('generates canonical locator.secret tokens', () => {
    const generated = generatePublicEstimateToken();

    expect(generated.token).toBe(`${generated.tokenId}.${generated.secret}`);
    expect(parsePublicEstimateToken(generated.token)).toEqual({
      tokenId: generated.tokenId,
      secret: generated.secret,
    });
  });

  it('rejects malformed tokens', () => {
    expect(parsePublicEstimateToken('invalid')).toBeNull();
    expect(parsePublicEstimateToken('not-a-uuid.secret')).toBeNull();
  });

  it('hashes secrets with the public pepper and verifies timing-safe', () => {
    const secret = generatePublicEstimateTokenSecret();
    const tokenHash = hashPublicEstimateTokenSecret(secret);

    expect(tokenHash.toString('hex')).not.toBe(Buffer.from(secret, 'utf8').toString('hex'));
    expect(verifyPublicEstimateTokenSecret(secret, tokenHash)).toBe(true);
    expect(
      verifyPublicEstimateTokenSecret(
        generatePublicEstimateTokenSecret(),
        tokenHash,
      ),
    ).toBe(false);
  });

  it('uses a different pepper than refresh tokens', () => {
    const secret = generatePublicEstimateTokenSecret();
    const publicHash = hashPublicEstimateTokenSecret(secret);
    const refreshHash = hashRefreshTokenSecret(secret);

    expect(publicHash.equals(refreshHash)).toBe(false);
  });

  it('parses Authorization: Estimate headers', () => {
    const generated = generatePublicEstimateToken();
    expect(
      parseEstimateAuthorizationHeader(`Estimate ${generated.token}`),
    ).toEqual({
      tokenId: generated.tokenId,
      secret: generated.secret,
    });
    expect(parseEstimateAuthorizationHeader('Bearer abc')).toBeNull();
  });

  it('builds fragment URLs without exposing secrets in the base URL', () => {
    const token = buildPublicEstimateToken(
      '11111111-1111-4111-8111-111111111111',
      generatePublicEstimateTokenSecret(),
    );
    const url = buildPublicEstimateAccessUrl(token);

    expect(url.startsWith(env.PUBLIC_ESTIMATE_BASE_URL)).toBe(true);
    expect(url).toContain('#token=');
    expect(url).toContain(token);
  });
});
