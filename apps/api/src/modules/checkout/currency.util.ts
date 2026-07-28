export const SETTLEMENT_CURRENCY = 'AED';

export const CHARGE_CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR'] as const;
export type ChargeCurrency = (typeof CHARGE_CURRENCIES)[number];

/** Approximate units of AED per 1 unit of the given currency. */
export const FX_TO_AED: Record<string, number> = {
  AED: 1,
  USD: 3.6725,
  EUR: 3.98,
  GBP: 4.65,
  SAR: 0.979,
};

export function isChargeCurrency(value: unknown): value is ChargeCurrency {
  return (
    typeof value === 'string' &&
    (CHARGE_CURRENCIES as readonly string[]).includes(value.toUpperCase())
  );
}

export function resolveChargeCurrency(value?: string | null): ChargeCurrency {
  if (isChargeCurrency(value)) return value.toUpperCase() as ChargeCurrency;
  return SETTLEMENT_CURRENCY;
}

export function convertAmount(
  amount: number,
  fromCurrency: string | null | undefined,
  toCurrency: string,
): number {
  if (!Number.isFinite(amount)) return 0;
  const from = (fromCurrency || SETTLEMENT_CURRENCY).toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return roundMoney(amount);
  const fromRate = FX_TO_AED[from];
  const toRate = FX_TO_AED[to];
  if (!fromRate || !toRate) return roundMoney(amount);
  return roundMoney((amount * fromRate) / toRate);
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
