import { describe, expect, it } from 'vitest';

import {
  getRefreshCookieClearOptions,
  getRefreshCookieOptions,
  type RefreshCookieConfig,
} from '../src/modules/auth/auth.cookies.js';

function createConfig(
  overrides: Partial<RefreshCookieConfig> = {},
): RefreshCookieConfig {
  return {
    AUTH_REFRESH_COOKIE_NAME: 'evolqity_refresh_test',
    AUTH_COOKIE_SECURE: false,
    AUTH_COOKIE_SAME_SITE: 'lax',
    AUTH_SESSION_TTL_DAYS: 30,
    ...overrides,
  };
}

describe('refresh cookie options', () => {
  it('uses secure, httpOnly, sameSite, path, and aligned maxAge settings', () => {
    const options = getRefreshCookieOptions(
      createConfig({
        AUTH_COOKIE_SECURE: true,
        AUTH_COOKIE_SAME_SITE: 'strict',
        AUTH_SESSION_TTL_DAYS: 7,
      }),
    );

    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60,
    });
    expect(options).not.toHaveProperty('domain');
  });

  it('responds to non-secure development configuration', () => {
    expect(getRefreshCookieOptions(createConfig()).secure).toBe(false);
  });

  it('clears with the same relevant security and path attributes', () => {
    expect(
      getRefreshCookieClearOptions(
        createConfig({
          AUTH_COOKIE_SECURE: true,
          AUTH_COOKIE_SAME_SITE: 'none',
        }),
      ),
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/auth',
    });
  });
});
