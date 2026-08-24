import { Injectable, Logger } from '@nestjs/common';

interface ExchangeRateResponse {
  result?: unknown;
  base_code?: unknown;
  rates?: unknown;
}

interface CachedRates {
  expiresAt: number;
  usdToCurrency: Map<string, number>;
}

interface UsdConversion {
  amountUsd: number;
  rateToUsd: number;
}

const DEFAULT_FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class RealtrackFxService {
  private readonly logger = new Logger(RealtrackFxService.name);
  private cache: CachedRates | null = null;
  private loadPromise: Promise<Map<string, number>> | null = null;
  private invalidConfigLogged = false;

  async toUsd(amount: number, sourceCurrency: string): Promise<UsdConversion> {
    const currency = this.normalize(sourceCurrency);
    if (!currency) throw new Error('Offer currency is missing');
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Offer cost is not a valid non-negative number');
    }
    if (currency === 'USD') {
      return { amountUsd: this.round(amount), rateToUsd: 1 };
    }

    const configuredRate = this.configuredRate(currency);
    if (configuredRate !== null) {
      return {
        amountUsd: this.round(amount * configuredRate),
        rateToUsd: configuredRate,
      };
    }

    const usdToCurrency = (await this.loadRates()).get(currency);
    if (
      !usdToCurrency ||
      !Number.isFinite(usdToCurrency) ||
      usdToCurrency <= 0
    ) {
      throw new Error(`No USD exchange rate is available for ${currency}`);
    }

    const rateToUsd = 1 / usdToCurrency;
    return {
      amountUsd: this.round(amount * rateToUsd),
      rateToUsd,
    };
  }

  private async loadRates(): Promise<Map<string, number>> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.usdToCurrency;
    }
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.fetchRates();
    try {
      const rates = await this.loadPromise;
      this.cache = {
        expiresAt: Date.now() + this.cacheTtlMs(),
        usdToCurrency: rates,
      };
      return rates;
    } finally {
      this.loadPromise = null;
    }
  }

  private async fetchRates(): Promise<Map<string, number>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(this.fxApiUrl(), {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`FX provider returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as ExchangeRateResponse;
      const rates = body.rates;
      if (
        body.result !== 'success' ||
        this.normalize(
          typeof body.base_code === 'string' ? body.base_code : '',
        ) !== 'USD' ||
        !rates ||
        typeof rates !== 'object'
      ) {
        throw new Error('FX provider returned an invalid USD rate response');
      }

      const normalized = new Map<string, number>([['USD', 1]]);
      for (const [currency, value] of Object.entries(rates)) {
        const rate = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(rate) && rate > 0) {
          normalized.set(this.normalize(currency), rate);
        }
      }
      return normalized;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'network error';
      this.logger.warn(`Could not load USD exchange rates: ${message}`);
      throw new Error('USD exchange rates are temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private configuredRate(currency: string): number | null {
    const raw = process.env.REALTRACK_BRIDGE_FX_RATES?.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[currency] ?? parsed[currency.toLowerCase()];
      const rate = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(rate) && rate > 0 ? rate : null;
    } catch {
      if (!this.invalidConfigLogged) {
        this.invalidConfigLogged = true;
        this.logger.warn(
          'REALTRACK_BRIDGE_FX_RATES is not valid JSON; falling back to the FX provider',
        );
      }
      return null;
    }
  }

  private fxApiUrl() {
    return (
      process.env.REALTRACK_BRIDGE_FX_API_URL || DEFAULT_FX_API_URL
    ).replace('{base}', 'USD');
  }

  private cacheTtlMs() {
    const configured = Number(process.env.REALTRACK_BRIDGE_FX_CACHE_TTL_MS);
    return Number.isFinite(configured) && configured >= 60_000
      ? configured
      : DEFAULT_CACHE_TTL_MS;
  }

  private normalize(value: string) {
    return value.trim().toUpperCase();
  }

  private round(value: number) {
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  }
}
