export function normalizePartNumber(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeMasterName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeImageUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.searchParams.delete('width');
    url.searchParams.delete('height');
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function deterministicSourceKey(...parts: unknown[]): string {
  return parts.map((part) => normalizeMasterName(part)).join(':');
}
