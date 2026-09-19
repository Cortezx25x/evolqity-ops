import { z } from 'zod';

const assetTypeSchema = z.enum(['VEHICLE', 'EQUIPMENT', 'DEVICE', 'OTHER']);
const maximumAssetYear = new Date().getUTCFullYear() + 1;

const optionalTrimmedString = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .optional()
    .transform((value) => (value === '' ? null : value));

const optionalUppercaseString = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === '') return null;
      return value.toUpperCase();
    });

const editableAssetFields = {
  customerId: z.uuid(),
  type: assetTypeSchema,
  name: z.string().trim().min(2).max(200),
  identifier: optionalTrimmedString(100),
  plate: optionalUppercaseString(32),
  vin: optionalUppercaseString(64),
  serialNumber: optionalTrimmedString(100),
  make: optionalTrimmedString(100),
  model: optionalTrimmedString(100),
  year: z
    .number()
    .int()
    .min(1900)
    .max(maximumAssetYear)
    .optional(),
  color: optionalTrimmedString(100),
  notes: optionalTrimmedString(5_000),
};

export const createAssetBodySchema = z
  .object({
    ...editableAssetFields,
    type: assetTypeSchema.default('VEHICLE'),
  })
  .strict();

export type CreateAssetBody = z.infer<typeof createAssetBodySchema>;

export const updateAssetBodySchema = z
  .object({
    customerId: editableAssetFields.customerId.optional(),
    type: editableAssetFields.type.optional(),
    name: editableAssetFields.name.optional(),
    identifier: editableAssetFields.identifier,
    plate: editableAssetFields.plate,
    vin: editableAssetFields.vin,
    serialNumber: editableAssetFields.serialNumber,
    make: editableAssetFields.make,
    model: editableAssetFields.model,
    year: editableAssetFields.year,
    color: editableAssetFields.color,
    notes: editableAssetFields.notes,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateAssetBody = z.infer<typeof updateAssetBodySchema>;

export const assetIdParamsSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const listAssetsQuerySchema = z
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
    type: assetTypeSchema.optional(),
    customerId: z.uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
