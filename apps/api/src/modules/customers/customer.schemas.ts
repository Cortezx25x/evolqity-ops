import { z } from 'zod';

const customerTypeSchema = z.enum(['PERSON', 'COMPANY']);

const optionalTrimmedString = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .optional()
    .transform((value) => (value === '' ? null : value));

const optionalEmail = z
  .string()
  .trim()
  .max(320)
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === '') {
      return null;
    }

    const normalized = value.toLowerCase();
    const result = z.email().safeParse(normalized);

    if (!result.success) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid email address',
      });
      return z.NEVER;
    }

    return normalized;
  });

export const createCustomerBodySchema = z
  .object({
    type: customerTypeSchema.default('PERSON'),
    name: z.string().trim().min(2).max(200),
    identification: optionalTrimmedString(100),
    email: optionalEmail,
    phone: optionalTrimmedString(50),
    notes: optionalTrimmedString(5_000),
  })
  .strict();

export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;

export const updateCustomerBodySchema = z
  .object({
    type: customerTypeSchema.optional(),
    name: z.string().trim().min(2).max(200).optional(),
    identification: optionalTrimmedString(100),
    email: optionalEmail,
    phone: optionalTrimmedString(50),
    notes: optionalTrimmedString(5_000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;

export const customerIdParamsSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const listCustomersQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    active: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value !== 'false'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
