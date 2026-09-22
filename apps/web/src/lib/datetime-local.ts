/** Format ISO date for `<input type="datetime-local" />` in local timezone. */
export function toDatetimeLocalInputValue(iso: string | null): string {
  if (iso === null) {
    return '';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocalInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
