import { z } from 'zod';

const slugPattern = /^[a-z0-9-]+$/;

export const createOrganizationBodySchema = z.object({
  name: z.string().trim().min(2),
  slug: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().min(2).regex(slugPattern)),
  type: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;

export const organizationIdParamsSchema = z.object({
  id: z.uuid(),
});

export type OrganizationIdParams = z.infer<typeof organizationIdParamsSchema>;
