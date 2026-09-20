import { Decimal } from 'decimal.js';
import { z } from 'zod';

export const estimateStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const estimateItemTypeSchema = z.enum([
  'LABOR',
  'PART',
  'SERVICE',
  'OTHER',
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

const decimalString = (
  pattern: RegExp,
  options: { minimum: string; maximum: string; exclusiveMinimum?: boolean },
) =>
  z
    .string()
    .trim()
    .regex(pattern)
    .refine((value) => {
      try {
        const parsed = new Decimal(value);
        const minimum = new Decimal(options.minimum);
        const validMinimum = options.exclusiveMinimum
          ? parsed.greaterThan(minimum)
          : parsed.greaterThanOrEqualTo(minimum);

        return (
          parsed.isFinite() &&
          validMinimum &&
          parsed.lessThanOrEqualTo(options.maximum)
        );
      } catch {
        return false;
      }
    });

const quantitySchema = decimalString(
  /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/,
  {
    minimum: '0',
    maximum: '1000000',
    exclusiveMinimum: true,
  },
);

const unitPriceSchema = decimalString(
  /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,
  {
    minimum: '0',
    maximum: '100000000',
  },
);

const percentSchema = decimalString(
  /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/,
  {
    minimum: '0',
    maximum: '100',
  },
);

export const estimateItemInputSchema = z
  .object({
    type: estimateItemTypeSchema,
    description: z.string().trim().min(1).max(500),
    quantity: quantitySchema,
    unitPrice: unitPriceSchema,
    discountPercent: percentSchema.default('0.00'),
    taxPercent: percentSchema.default('0.00'),
  })
  .strict();

export type EstimateItemInput = z.infer<typeof estimateItemInputSchema>;

export const createEstimateBodySchema = z
  .object({
    currency: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/)),
    notes: optionalText(10_000),
    terms: optionalText(10_000),
    validUntil: optionalDate,
    items: z.array(estimateItemInputSchema).max(100).default([]),
  })
  .strict();

export type CreateEstimateBody = z.infer<typeof createEstimateBodySchema>;

export const updateEstimateBodySchema = z
  .object({
    currency: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/))
      .optional(),
    notes: optionalText(10_000),
    terms: optionalText(10_000),
    validUntil: optionalDate,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateEstimateBody = z.infer<typeof updateEstimateBodySchema>;

export const updateEstimateItemBodySchema = estimateItemInputSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateEstimateItemBody = z.infer<
  typeof updateEstimateItemBodySchema
>;

export const listEstimatesQuerySchema = z
  .object({
    status: estimateStatusSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ListEstimatesQuery = z.infer<
  typeof listEstimatesQuerySchema
>;

export const workOrderEstimateParamsSchema = z
  .object({
    workOrderId: z.uuid(),
  })
  .strict();

export const estimateIdParamsSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const estimateItemParamsSchema = z
  .object({
    estimateId: z.uuid(),
    itemId: z.uuid(),
  })
  .strict();

export const updateEstimateStatusBodySchema = z
  .object({
    status: z.enum(['SENT', 'APPROVED', 'REJECTED', 'CANCELLED']),
  })
  .strict();

export type UpdateEstimateStatusBody = z.infer<
  typeof updateEstimateStatusBodySchema
>;
