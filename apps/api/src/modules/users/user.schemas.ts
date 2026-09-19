import { z } from 'zod';

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const createUserBodySchema = z.object({
  email: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.email()),
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const userIdParamsSchema = z.object({
  id: z.uuid(),
});

export type UserIdParams = z.infer<typeof userIdParamsSchema>;
