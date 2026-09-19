import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { env } from '../../config/env.js';
import type {
  AccessTokenInput,
  GeneratedRefreshToken,
  ParsedRefreshToken,
} from './auth.types.js';

const REFRESH_TOKEN_SECRET_BYTES = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCanonicalRefreshSecret(secret: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    return false;
  }

  const decoded = Buffer.from(secret, 'base64url');

  return (
    decoded.length === REFRESH_TOKEN_SECRET_BYTES &&
    decoded.toString('base64url') === secret
  );
}

export function signAccessToken(
  jwt: FastifyInstance['jwt'],
  input: AccessTokenInput,
): string {
  return jwt.sign(
    {
      sub: input.userId,
      sid: input.authSessionId,
      typ: 'access',
      jti: randomUUID(),
    },
    {
      expiresIn: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      iss: env.AUTH_JWT_ISSUER,
      aud: env.AUTH_JWT_AUDIENCE,
    },
  );
}

export function generateRefreshTokenSecret(): string {
  return randomBytes(REFRESH_TOKEN_SECRET_BYTES).toString('base64url');
}

export function buildRefreshToken(tokenId: string, secret: string): string {
  if (!UUID_PATTERN.test(tokenId) || !isCanonicalRefreshSecret(secret)) {
    throw new Error('Invalid refresh token components.');
  }

  return `${tokenId}.${secret}`;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const tokenId = randomUUID();
  const secret = generateRefreshTokenSecret();

  return {
    tokenId,
    secret,
    token: buildRefreshToken(tokenId, secret),
  };
}

export function parseRefreshToken(token: string): ParsedRefreshToken | null {
  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [tokenId, secret] = parts;

  if (
    tokenId === undefined ||
    secret === undefined ||
    !UUID_PATTERN.test(tokenId) ||
    !isCanonicalRefreshSecret(secret)
  ) {
    return null;
  }

  return { tokenId, secret };
}

export function hashRefreshTokenSecret(secret: string): Buffer {
  if (!isCanonicalRefreshSecret(secret)) {
    throw new Error('Invalid refresh token secret.');
  }

  return createHmac('sha256', env.AUTH_REFRESH_TOKEN_PEPPER)
    .update(secret, 'utf8')
    .digest();
}

export function verifyRefreshTokenSecret(
  secret: string,
  expectedHash: Uint8Array,
): boolean {
  if (!isCanonicalRefreshSecret(secret)) {
    return false;
  }

  const candidateHash = hashRefreshTokenSecret(secret);
  const storedHash = Buffer.from(expectedHash);

  return (
    candidateHash.length === storedHash.length &&
    timingSafeEqual(candidateHash, storedHash)
  );
}
