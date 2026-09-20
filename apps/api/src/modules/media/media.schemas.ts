import { z } from 'zod';

export const mediaIdParamsSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const mediaWorkOrderParamsSchema = z
  .object({
    workOrderId: z.uuid(),
  })
  .strict();

export const mediaInspectionParamsSchema = z
  .object({
    inspectionId: z.uuid(),
  })
  .strict();

export const mediaInspectionItemParamsSchema = z
  .object({
    inspectionId: z.uuid(),
    itemId: z.uuid(),
  })
  .strict();

export const mediaCaptionValueSchema = z
  .union([z.string().trim().max(500), z.null()])
  .optional()
  .transform((value) => (value === '' ? null : value));

export const updateMediaBodySchema = z
  .object({
    caption: z.union([z.string().trim().max(500), z.null()]),
  })
  .strict();

export type UpdateMediaBody = z.infer<typeof updateMediaBodySchema>;
