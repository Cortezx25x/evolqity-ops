import { z } from 'zod';

import {
  initialPasswordSchema,
  normalizedEmailSchema,
  requiredUserNameSchema,
} from '../auth/auth.schemas.js';

export const organizationIdParamsSchema = z.object({
  organizationId: z.uuid(),
});

export type OrganizationIdParams = z.infer<typeof organizationIdParamsSchema>;

export const organizationMembershipParamsSchema = organizationIdParamsSchema.extend(
  {
    membershipId: z.uuid(),
  },
);

export type OrganizationMembershipParams = z.infer<
  typeof organizationMembershipParamsSchema
>;

export const organizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);

export const createOrganizationMemberBodySchema = z.object({
  userId: z.uuid(),
  role: organizationRoleSchema,
});

export type CreateOrganizationMemberBody = z.infer<
  typeof createOrganizationMemberBodySchema
>;

export const provisionOrganizationMemberBodySchema = z
  .object({
    firstName: requiredUserNameSchema,
    lastName: requiredUserNameSchema,
    email: normalizedEmailSchema,
    password: initialPasswordSchema,
    role: organizationRoleSchema,
  })
  .strict();

export type ProvisionOrganizationMemberBody = z.infer<
  typeof provisionOrganizationMemberBodySchema
>;
