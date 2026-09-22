const MONEY_PATTERN = /^-?\d+\.\d{2}$/;
const QUANTITY_PATTERN = /^-?\d+\.\d{3}$/;

function isZeroMoney(value: string): boolean {
  return value === '0.00' || value === '-0.00';
}

function isZeroPercent(value: string): boolean {
  return value === '0.00' || value === '-0.00';
}

/**
 * Display-only formatting for backend decimal strings.
 * Does not recalculate totals or perform monetary arithmetic.
 */
export function formatMoney(amount: string, currency: string): string {
  const normalized = amount.trim();
  const iso = currency.trim().toUpperCase();

  if (!MONEY_PATTERN.test(normalized)) {
    return `${iso} ${normalized}`;
  }

  try {
    const [whole, fraction] = normalized.split('.');
    const numeric = Number(`${whole}.${fraction}`);
    if (!Number.isFinite(numeric)) {
      return `${iso} ${normalized}`;
    }

    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: iso,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${iso} ${normalized}`;
  }
}

export function formatQuantity(quantity: string): string {
  const normalized = quantity.trim();
  if (!QUANTITY_PATTERN.test(normalized)) {
    return normalized;
  }

  return normalized;
}

export function formatPercent(percent: string): string {
  const normalized = percent.trim();
  if (isZeroPercent(normalized)) {
    return '';
  }

  return `${normalized}%`;
}

export { isZeroMoney, isZeroPercent };
