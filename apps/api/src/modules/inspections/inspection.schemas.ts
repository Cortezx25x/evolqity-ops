import { z } from 'zod';

export const inspectionStatusSchema = z.enum(['DRAFT', 'COMPLETED']);

export const inspectionItemConditionSchema = z.enum([
  'OK',
  'ATTENTION',
  'FAIL',
  'NOT_APPLICABLE',
]);

const optionalText = (maximumLength: number) =>
  z
    .union([z.string().trim().max(maximumLength), z.null()])
    .optional()
    .transform((value) => (value === '' ? null : value));

const initialItemSchema = z
  .object({
    label: z.string().trim().min(2).max(200),
    description: optionalText(5_000),
  })
  .strict();

export const createInspectionBodySchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    notes: optionalText(10_000),
    items: z.array(initialItemSchema).max(200).default([]),
  })
  .strict();

export type CreateInspectionBody = z.infer<
  typeof createInspectionBodySchema
>;

export const workOrderIdParamsSchema = z
  .object({
    workOrderId: z.uuid(),
  })
  .strict();

export const inspectionIdParamsSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const inspectionItemParamsSchema = z
  .object({
    inspectionId: z.uuid(),
    itemId: z.uuid(),
  })
  .strict();

export const listInspectionsQuerySchema = z
  .object({
    status: inspectionStatusSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListInspectionsQuery = z.infer<
  typeof listInspectionsQuerySchema
>;

export const updateInspectionBodySchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    notes: optionalText(10_000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateInspectionBody = z.infer<
  typeof updateInspectionBodySchema
>;

export const addInspectionItemBodySchema = initialItemSchema;

export type AddInspectionItemBody = z.infer<
  typeof addInspectionItemBodySchema
>;

export const updateInspectionItemBodySchema = z
  .object({
    label: z.string().trim().min(2).max(200).optional(),
    description: optionalText(5_000),
    condition: inspectionItemConditionSchema.nullable().optional(),
    notes: optionalText(5_000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateInspectionItemBody = z.infer<
  typeof updateInspectionItemBodySchema
>;
