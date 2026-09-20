import 'dotenv/config';

import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const positiveInteger = (defaultValue: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().default(defaultValue),
  );

const booleanFromEnvironment = (defaultValue: boolean) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === '') {
        return defaultValue;
      }

      if (value === 'true' || value === true) {
        return true;
      }

      if (value === 'false' || value === false) {
        return false;
      }

      return value;
    },
    z.boolean(),
  );

const corsOrigins = z
  .string()
  .default('http://localhost:5173,http://127.0.0.1:5173')
  .transform((value, context) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (origins.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'must contain at least one origin',
      });

      return z.NEVER;
    }

    return origins;
  });

const envSchema = z
  .object({
    PORT: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(1).max(65535).default(3001),
    ),
    HOST: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).default('127.0.0.1'),
    ),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z.string().trim().min(1),
    AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: positiveInteger(900),
    AUTH_REFRESH_TOKEN_PEPPER: z.string().min(32),
    AUTH_SESSION_TTL_DAYS: positiveInteger(30),
    AUTH_JWT_ISSUER: z.string().trim().min(1).default('evolqity-ops-api'),
    AUTH_JWT_AUDIENCE: z.string().trim().min(1).default('evolqity-ops'),
    AUTH_REFRESH_COOKIE_NAME: z
      .string()
      .trim()
      .min(1)
      .default('evolqity_refresh'),
    AUTH_COOKIE_SECURE: booleanFromEnvironment(false),
    AUTH_COOKIE_SAME_SITE: z
      .enum(['lax', 'strict', 'none'])
      .default('lax'),
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY: booleanFromEnvironment(false),
    AUTH_LOGIN_RATE_LIMIT_MAX: positiveInteger(5),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: positiveInteger(60),
    MEDIA_STORAGE_DRIVER: z.literal('local').default('local'),
    MEDIA_LOCAL_ROOT: z.string().trim().min(1),
    MEDIA_MAX_FILE_SIZE_BYTES: positiveInteger(10_485_760),
  })
  .superRefine((value, context) => {
    if (value.AUTH_COOKIE_SAME_SITE === 'none' && !value.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'must be true when AUTH_COOKIE_SAME_SITE is none',
      });
    }

    if (
      value.AUTH_REFRESH_COOKIE_NAME.startsWith('__Secure-') &&
      !value.AUTH_COOKIE_SECURE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_COOKIE_NAME'],
        message: 'cannot use the __Secure- prefix when AUTH_COOKIE_SECURE is false',
      });
    }
  });

export type Environment = z.infer<typeof envSchema>;

export function parseEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}

export const env = parseEnvironment();
