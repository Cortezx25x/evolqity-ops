import { z } from 'zod';

function rejectOrganizationIdInValue<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, context) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      'organizationId' in value
    ) {
      context.addIssue({
        code: 'custom',
        message: 'organizationId is not allowed',
        path: ['organizationId'],
      });
    }
  });
}

export const publicEstimateDecisionBodySchema = rejectOrganizationIdInValue(
  z
    .object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      responderName: z
        .string()
        .trim()
        .min(2, 'responderName must be at least 2 characters')
        .max(120, 'responderName must be at most 120 characters'),
      rejectionReason: z.string().trim().max(2000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.decision === 'APPROVED' &&
        value.rejectionReason !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          message: 'rejectionReason is only allowed for REJECTED',
          path: ['rejectionReason'],
        });
      }
    }),
);

export type PublicEstimateDecisionBody = z.infer<
  typeof publicEstimateDecisionBodySchema
>;

export function queryRejectsOrganizationId(query: unknown): boolean {
  if (typeof query !== 'object' || query === null) {
    return true;
  }

  return !('organizationId' in query);
}
