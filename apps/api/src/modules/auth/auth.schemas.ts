import { z } from 'zod';

export const normalizedEmailSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.email());

export const initialPasswordSchema = z.string().min(10).max(128);

export const requiredUserNameSchema = z.string().trim().min(1);

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const registerBodySchema = z.object({
  email: normalizedEmailSchema,
  password: initialPasswordSchema,
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  organizationName: z.string().trim().min(2),
  organizationSlug: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().min(2).regex(/^[a-z0-9-]+$/)),
  organizationType: optionalTrimmedString,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1).max(128),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const selectOrganizationBodySchema = z.object({
  organizationId: z.uuid(),
});

export type SelectOrganizationBody = z.infer<
  typeof selectOrganizationBodySchema
>;
