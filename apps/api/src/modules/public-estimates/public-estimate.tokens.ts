import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '../../config/env.js';

const PUBLIC_ESTIMATE_TOKEN_SECRET_BYTES = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GeneratedPublicEstimateToken {
  tokenId: string;
  secret: string;
  token: string;
}

export interface ParsedPublicEstimateToken {
  tokenId: string;
  secret: string;
}

function isCanonicalPublicEstimateSecret(secret: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    return false;
  }

  const decoded = Buffer.from(secret, 'base64url');

  return (
    decoded.length === PUBLIC_ESTIMATE_TOKEN_SECRET_BYTES &&
    decoded.toString('base64url') === secret
  );
}

export function generatePublicEstimateTokenSecret(): string {
  return randomBytes(PUBLIC_ESTIMATE_TOKEN_SECRET_BYTES).toString('base64url');
}

export function buildPublicEstimateToken(
  tokenId: string,
  secret: string,
): string {
  if (!UUID_PATTERN.test(tokenId) || !isCanonicalPublicEstimateSecret(secret)) {
    throw new Error('Invalid public estimate token components.');
  }

  return `${tokenId}.${secret}`;
}

export function generatePublicEstimateToken(): GeneratedPublicEstimateToken {
  const tokenId = randomUUID();
  const secret = generatePublicEstimateTokenSecret();

  return {
    tokenId,
    secret,
    token: buildPublicEstimateToken(tokenId, secret),
  };
}

export function parsePublicEstimateToken(
  token: string,
): ParsedPublicEstimateToken | null {
  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [tokenId, secret] = parts;

  if (
    tokenId === undefined ||
    secret === undefined ||
    !UUID_PATTERN.test(tokenId) ||
    !isCanonicalPublicEstimateSecret(secret)
  ) {
    return null;
  }

  return { tokenId, secret };
}

export function hashPublicEstimateTokenSecret(secret: string): Buffer {
  if (!isCanonicalPublicEstimateSecret(secret)) {
    throw new Error('Invalid public estimate token secret.');
  }

  return createHmac('sha256', env.PUBLIC_ESTIMATE_TOKEN_PEPPER)
    .update(secret, 'utf8')
    .digest();
}

export function verifyPublicEstimateTokenSecret(
  secret: string,
  expectedHash: Uint8Array,
): boolean {
  if (!isCanonicalPublicEstimateSecret(secret)) {
    return false;
  }

  const candidateHash = hashPublicEstimateTokenSecret(secret);
  const storedHash = Buffer.from(expectedHash);

  return (
    candidateHash.length === storedHash.length &&
    timingSafeEqual(candidateHash, storedHash)
  );
}

export function buildPublicEstimateAccessUrl(token: string): string {
  return `${env.PUBLIC_ESTIMATE_BASE_URL}#token=${token}`;
}

export function parseEstimateAuthorizationHeader(
  authorization: string | undefined,
): ParsedPublicEstimateToken | null {
  if (authorization === undefined) {
    return null;
  }

  const prefix = 'Estimate ';
  if (!authorization.startsWith(prefix)) {
    return null;
  }

  const token = authorization.slice(prefix.length).trim();
  if (token.length === 0) {
    return null;
  }

  return parsePublicEstimateToken(token);
}
