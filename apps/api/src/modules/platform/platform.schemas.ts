import { z } from 'zod';

export const listPlatformOrganizationsQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional(),
    status: z.enum(['active', 'inactive']).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListPlatformOrganizationsQuery = z.infer<
  typeof listPlatformOrganizationsQuerySchema
>;

export const platformOrganizationIdParamsSchema = z
  .object({
    organizationId: z.uuid(),
  })
  .strict();

export const updatePlatformOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(2).max(200),
  })
  .strict();

export type UpdatePlatformOrganizationBody = z.infer<
  typeof updatePlatformOrganizationBodySchema
>;
