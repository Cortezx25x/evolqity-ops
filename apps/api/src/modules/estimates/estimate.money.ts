import { Decimal } from 'decimal.js';

const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

const MAX_MONEY = new ExactDecimal('999999999999.99');

export class EstimateMoneyError extends Error {
  constructor(message = 'Invalid monetary value') {
    super(message);
    this.name = 'EstimateMoneyError';
  }
}

export interface EstimateItemCalculationInput {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
}

export interface CalculatedEstimateItem {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
}

export interface EstimateTotals {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
}

export interface EstimateTotalSource {
  subtotal: Decimal.Value;
  discountAmount: Decimal.Value;
  taxAmount: Decimal.Value;
  total: Decimal.Value;
}

function decimal(value: Decimal.Value): Decimal {
  const parsed = new ExactDecimal(value);
  if (!parsed.isFinite()) {
    throw new EstimateMoneyError();
  }
  return parsed;
}

function money(value: Decimal.Value): Decimal {
  const rounded = decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (rounded.abs().greaterThan(MAX_MONEY)) {
    throw new EstimateMoneyError('Monetary value exceeds supported range');
  }
  return rounded;
}

function decimalInput(
  value: string,
  pattern: RegExp,
  maximum: string,
): Decimal {
  if (!pattern.test(value)) {
    throw new EstimateMoneyError();
  }

  const parsed = decimal(value);
  if (parsed.greaterThan(maximum)) {
    throw new EstimateMoneyError('Decimal value outside supported range');
  }
  return parsed;
}

export function serializeMoney(value: Decimal.Value): string {
  return money(value).toFixed(2);
}

export function serializeQuantity(value: Decimal.Value): string {
  return decimal(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function serializePercent(value: Decimal.Value): string {
  return decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function calculateEstimateItem(
  input: EstimateItemCalculationInput,
): CalculatedEstimateItem {
  const quantity = decimalInput(
    input.quantity,
    /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/,
    '1000000',
  );
  const unitPrice = decimalInput(
    input.unitPrice,
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,
    '100000000',
  );
  const discountPercent = decimalInput(
    input.discountPercent,
    /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/,
    '100',
  );
  const taxPercent = decimalInput(
    input.taxPercent,
    /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/,
    '100',
  );

  if (
    !quantity.greaterThan(0) ||
    !unitPrice.greaterThanOrEqualTo(0) ||
    !discountPercent.greaterThanOrEqualTo(0) ||
    !taxPercent.greaterThanOrEqualTo(0)
  ) {
    throw new EstimateMoneyError('Decimal value outside supported range');
  }

  const subtotal = money(quantity.times(unitPrice));
  const discountAmount = money(
    subtotal.times(discountPercent).dividedBy(100),
  );
  const taxableAmount = money(subtotal.minus(discountAmount));
  const taxAmount = money(taxableAmount.times(taxPercent).dividedBy(100));
  const total = money(taxableAmount.plus(taxAmount));

  return {
    quantity: serializeQuantity(quantity),
    unitPrice: serializeMoney(unitPrice),
    discountPercent: serializePercent(discountPercent),
    taxPercent: serializePercent(taxPercent),
    subtotal: serializeMoney(subtotal),
    discountAmount: serializeMoney(discountAmount),
    taxableAmount: serializeMoney(taxableAmount),
    taxAmount: serializeMoney(taxAmount),
    total: serializeMoney(total),
  };
}

export function calculateEstimateTotals(
  items: readonly EstimateTotalSource[],
): EstimateTotals {
  const totals = items.reduce(
    (accumulator, item) => ({
      subtotal: accumulator.subtotal.plus(item.subtotal),
      discountTotal: accumulator.discountTotal.plus(item.discountAmount),
      taxTotal: accumulator.taxTotal.plus(item.taxAmount),
      total: accumulator.total.plus(item.total),
    }),
    {
      subtotal: new ExactDecimal(0),
      discountTotal: new ExactDecimal(0),
      taxTotal: new ExactDecimal(0),
      total: new ExactDecimal(0),
    },
  );

  return {
    subtotal: serializeMoney(totals.subtotal),
    discountTotal: serializeMoney(totals.discountTotal),
    taxTotal: serializeMoney(totals.taxTotal),
    total: serializeMoney(totals.total),
  };
}
