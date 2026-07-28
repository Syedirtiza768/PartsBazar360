/**
 * Phase 1 currency model:
 * - Display currency is IP-suggested and user-overridable.
 * - Settlement / Stripe charge currency stays AED.
 * - FX table is approximate and for browsing estimates only.
 */

export const SETTLEMENT_CURRENCY = "AED" as const;

export const DISPLAY_CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const CURRENCY_LABELS: Record<DisplayCurrency, string> = {
  AED: "AED — UAE Dirham",
  USD: "USD — US Dollar",
  EUR: "EUR — Euro",
  GBP: "GBP — British Pound",
  SAR: "SAR — Saudi Riyal",
};

/** Approximate units of AED per 1 unit of the given currency. */
export const FX_TO_AED: Record<string, number> = {
  AED: 1,
  USD: 3.6725,
  EUR: 3.98,
  GBP: 4.65,
  SAR: 0.979,
  INR: 0.044,
  PKR: 0.0132,
  CAD: 2.68,
  AUD: 2.4,
};

/** ISO country code → preferred display currency. */
export const COUNTRY_CURRENCY: Record<string, DisplayCurrency> = {
  AE: "AED",
  SA: "SAR",
  US: "USD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  FI: "EUR",
  GR: "EUR",
  AU: "USD",
  CA: "USD",
  IN: "USD",
  PK: "USD",
};

export function isDisplayCurrency(value: string | null | undefined): value is DisplayCurrency {
  return Boolean(value && (DISPLAY_CURRENCIES as readonly string[]).includes(value));
}

export function currencyForCountry(countryCode: string | null | undefined): DisplayCurrency {
  if (!countryCode) return SETTLEMENT_CURRENCY;
  const code = countryCode.trim().toUpperCase();
  return COUNTRY_CURRENCY[code] ?? SETTLEMENT_CURRENCY;
}

export function convertAmount(
  amount: number,
  fromCurrency: string | null | undefined,
  toCurrency: string,
): number {
  if (!Number.isFinite(amount)) return amount;
  const from = (fromCurrency || SETTLEMENT_CURRENCY).toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return amount;
  const fromRate = FX_TO_AED[from];
  const toRate = FX_TO_AED[to];
  if (!fromRate || !toRate) return amount;
  return (amount * fromRate) / toRate;
}
