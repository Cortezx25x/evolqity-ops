import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import 'dotenv/config';

process.env.NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL === undefined) {
  throw new Error('TEST_DATABASE_URL is required to run API tests.');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_ACCESS_TOKEN_SECRET = randomBytes(48).toString('base64url');
process.env.AUTH_REFRESH_TOKEN_PEPPER = randomBytes(48).toString('base64url');
process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.AUTH_SESSION_TTL_DAYS = '30';
process.env.AUTH_JWT_ISSUER = 'evolqity-ops-api-test';
process.env.AUTH_JWT_AUDIENCE = 'evolqity-ops-test';
process.env.AUTH_REFRESH_COOKIE_NAME = 'evolqity_refresh_test';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_COOKIE_SAME_SITE = 'lax';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.TRUST_PROXY = 'false';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1000';
process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS = '60';
process.env.MEDIA_STORAGE_DRIVER = 'local';
process.env.MEDIA_LOCAL_ROOT = path.join(
  tmpdir(),
  'evolqity-ops-media-test',
  String(process.pid),
);
process.env.MEDIA_MAX_FILE_SIZE_BYTES = '10485760';
