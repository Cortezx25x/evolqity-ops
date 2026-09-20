import { z } from 'zod';

export const workOrderStatusSchema = z.enum([
  'DRAFT',
  'OPEN',
  'IN_PROGRESS',
  'WAITING',
  'COMPLETED',
  'CANCELLED',
]);

export const workOrderPrioritySchema = z.enum([
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
]);

const optionalText = (maximumLength: number) =>
  z
    .union([z.string().trim().max(maximumLength), z.null()])
    .optional()
    .transform((value) => (value === '' ? null : value));

const optionalDate = z
  .union([z.iso.datetime(), z.null()])
  .optional()
  .transform((value) =>
    typeof value === 'string' ? new Date(value) : value,
  );

export const createWorkOrderBodySchema = z
  .object({
    customerId: z.uuid(),
    assetId: z.uuid().nullable().optional(),
    title: z.string().trim().min(2).max(200),
    description: optionalText(10_000),
    diagnosis: optionalText(10_000),
    internalNotes: optionalText(10_000),
    priority: workOrderPrioritySchema.default('NORMAL'),
    assignedToMembershipId: z.uuid().nullable().optional(),
    scheduledAt: optionalDate,
  })
  .strict();

export type CreateWorkOrderBody = z.infer<
  typeof createWorkOrderBodySchema
>;

export const updateWorkOrderBodySchema = z
  .object({
    customerId: z.uuid().optional(),
    assetId: z.uuid().nullable().optional(),
    title: z.string().trim().min(2).max(200).optional(),
    description: optionalText(10_000),
    diagnosis: optionalText(10_000),
    resolution: optionalText(10_000),
    internalNotes: optionalText(10_000),
    priority: workOrderPrioritySchema.optional(),
    assignedToMembershipId: z.uuid().nullable().optional(),
    scheduledAt: optionalDate,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateWorkOrderBody = z.infer<
  typeof updateWorkOrderBodySchema
>;

export const workOrderIdParamsSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const listWorkOrdersQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    status: workOrderStatusSchema.optional(),
    priority: workOrderPrioritySchema.optional(),
    customerId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    assignedToMembershipId: z.uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListWorkOrdersQuery = z.infer<
  typeof listWorkOrdersQuerySchema
>;

export const updateWorkOrderStatusBodySchema = z
  .object({
    status: workOrderStatusSchema,
  })
  .strict();

export type UpdateWorkOrderStatusBody = z.infer<
  typeof updateWorkOrderStatusBodySchema
>;
