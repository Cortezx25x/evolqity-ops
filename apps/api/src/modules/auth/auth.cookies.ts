import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

import { env } from '../../config/env.js';
import type { Environment } from '../../config/env.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

export type RefreshCookieConfig = Pick<
  Environment,
  | 'AUTH_REFRESH_COOKIE_NAME'
  | 'AUTH_COOKIE_SECURE'
  | 'AUTH_COOKIE_SAME_SITE'
  | 'AUTH_SESSION_TTL_DAYS'
>;

export function getRefreshCookieOptions(
  config: RefreshCookieConfig = env,
  maxAgeSeconds = config.AUTH_SESSION_TTL_DAYS * SECONDS_PER_DAY,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: config.AUTH_COOKIE_SECURE,
    sameSite: config.AUTH_COOKIE_SAME_SITE,
    path: '/api/auth',
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

export function getRefreshCookieClearOptions(
  config: RefreshCookieConfig = env,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: config.AUTH_COOKIE_SECURE,
    sameSite: config.AUTH_COOKIE_SAME_SITE,
    path: '/api/auth',
  };
}

export function setRefreshTokenCookie(
  reply: FastifyReply,
  refreshToken: string,
  expiresAt?: Date,
): void {
  const maxAgeSeconds =
    expiresAt === undefined
      ? undefined
      : (expiresAt.getTime() - Date.now()) / 1000;

  reply.setCookie(
    env.AUTH_REFRESH_COOKIE_NAME,
    refreshToken,
    getRefreshCookieOptions(env, maxAgeSeconds),
  );
}

export function clearRefreshTokenCookie(reply: FastifyReply): void {
  reply.clearCookie(
    env.AUTH_REFRESH_COOKIE_NAME,
    getRefreshCookieClearOptions(),
  );
}
