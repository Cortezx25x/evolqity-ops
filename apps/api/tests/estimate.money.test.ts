import { describe, expect, it } from 'vitest';

import {
  EstimateMoneyError,
  calculateEstimateItem,
  calculateEstimateTotals,
} from '../src/modules/estimates/estimate.money.js';

describe('estimate money calculations', () => {
  it('calculates quantity 2 times unit price 100', () => {
    expect(
      calculateEstimateItem({
        quantity: '2',
        unitPrice: '100',
        discountPercent: '0',
        taxPercent: '0',
      }),
    ).toMatchObject({
      quantity: '2.000',
      unitPrice: '100.00',
      subtotal: '200.00',
      total: '200.00',
    });
  });

  it('calculates a 10 percent discount', () => {
    expect(
      calculateEstimateItem({
        quantity: '2',
        unitPrice: '100',
        discountPercent: '10',
        taxPercent: '0',
      }),
    ).toMatchObject({
      subtotal: '200.00',
      discountAmount: '20.00',
      taxableAmount: '180.00',
      total: '180.00',
    });
  });

  it('calculates a 13 percent tax', () => {
    expect(
      calculateEstimateItem({
        quantity: '2',
        unitPrice: '100',
        discountPercent: '0',
        taxPercent: '13',
      }),
    ).toMatchObject({
      subtotal: '200.00',
      taxAmount: '26.00',
      total: '226.00',
    });
  });

  it('calculates the required discount plus tax example exactly', () => {
    expect(
      calculateEstimateItem({
        quantity: '2',
        unitPrice: '100',
        discountPercent: '10',
        taxPercent: '13',
      }),
    ).toEqual({
      quantity: '2.000',
      unitPrice: '100.00',
      discountPercent: '10.00',
      taxPercent: '13.00',
      subtotal: '200.00',
      discountAmount: '20.00',
      taxableAmount: '180.00',
      taxAmount: '23.40',
      total: '203.40',
    });
  });

  it('supports fractional quantities without binary floating point', () => {
    expect(
      calculateEstimateItem({
        quantity: '0.100',
        unitPrice: '0.20',
        discountPercent: '0',
        taxPercent: '0',
      }),
    ).toMatchObject({
      quantity: '0.100',
      subtotal: '0.02',
      total: '0.02',
    });
  });

  it('rounds monetary values half-up at .005', () => {
    expect(
      calculateEstimateItem({
        quantity: '0.005',
        unitPrice: '1.00',
        discountPercent: '0',
        taxPercent: '0',
      }),
    ).toMatchObject({
      subtotal: '0.01',
      total: '0.01',
    });
  });

  it('keeps zero tax exact', () => {
    expect(
      calculateEstimateItem({
        quantity: '1.250',
        unitPrice: '8.00',
        discountPercent: '0',
        taxPercent: '0',
      }),
    ).toMatchObject({
      subtotal: '10.00',
      taxAmount: '0.00',
      total: '10.00',
    });
  });

  it('supports a 100 percent discount and 100 percent tax', () => {
    expect(
      calculateEstimateItem({
        quantity: '1',
        unitPrice: '25',
        discountPercent: '100',
        taxPercent: '100',
      }),
    ).toMatchObject({
      subtotal: '25.00',
      discountAmount: '25.00',
      taxableAmount: '0.00',
      taxAmount: '0.00',
      total: '0.00',
    });
  });

  it('calculates large values and aggregate totals within the DB range', () => {
    const item = calculateEstimateItem({
      quantity: '1000.000',
      unitPrice: '999999.99',
      discountPercent: '1.25',
      taxPercent: '13',
    });

    expect(item.subtotal).toBe('999999990.00');
    expect(calculateEstimateTotals([item, item])).toEqual({
      subtotal: '1999999980.00',
      discountTotal: '24999999.76',
      taxTotal: '256749997.44',
      total: '2231749977.68',
    });
  });

  it.each([
    {
      quantity: 'NaN',
      unitPrice: '1',
      discountPercent: '0',
      taxPercent: '0',
    },
    {
      quantity: 'Infinity',
      unitPrice: '1',
      discountPercent: '0',
      taxPercent: '0',
    },
    {
      quantity: '1e3',
      unitPrice: '1',
      discountPercent: '0',
      taxPercent: '0',
    },
    {
      quantity: '1.0001',
      unitPrice: '1',
      discountPercent: '0',
      taxPercent: '0',
    },
    {
      quantity: '-1',
      unitPrice: '1',
      discountPercent: '0',
      taxPercent: '0',
    },
    {
      quantity: '1',
      unitPrice: '-1',
      discountPercent: '0',
      taxPercent: '0',
    },
    {
      quantity: '1',
      unitPrice: '1',
      discountPercent: '100.01',
      taxPercent: '0',
    },
  ])('rejects invalid decimal input %#', (input) => {
    expect(() => calculateEstimateItem(input)).toThrow();
  });

  it('rejects totals outside Decimal(14,2)', () => {
    expect(() =>
      calculateEstimateTotals([
        {
          subtotal: '999999999999.99',
          discountAmount: '0',
          taxAmount: '0',
          total: '999999999999.99',
        },
        {
          subtotal: '0.01',
          discountAmount: '0',
          taxAmount: '0',
          total: '0.01',
        },
      ]),
    ).toThrow(EstimateMoneyError);
  });
});
