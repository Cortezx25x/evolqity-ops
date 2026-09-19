import { z } from 'zod';

export const organizationIdParamsSchema = z.object({
  organizationId: z.uuid(),
});

export type OrganizationIdParams = z.infer<typeof organizationIdParamsSchema>;

export const createOrganizationMemberBodySchema = z.object({
  userId: z.uuid(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

export type CreateOrganizationMemberBody = z.infer<
  typeof createOrganizationMemberBodySchema
>;
