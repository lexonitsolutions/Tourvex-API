import { BASE_CURRENCY, SUPPORTED_CURRENCIES } from './currency.constants';

/** One small adapter boundary: swapping the rate source means writing another FxProvider. */
export interface FxSnapshot {
  rates: Record<string, number>;
  providerUpdatedAt: Date;
}

export interface FxProvider {
  readonly source: string;
  readonly attribution: string;
  fetchRates(): Promise<FxSnapshot>;
}

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Validates an open.er-api.com style payload; throws on anything suspicious. Keeps supported codes only. */
export function parseExchangeRatePayload(payload: unknown): FxSnapshot {
  if (!payload || typeof payload !== 'object') throw new Error('FX payload is not an object');
  const data = payload as Record<string, unknown>;
  if (data.result !== 'success') throw new Error('FX provider did not report success');
  if (data.base_code !== BASE_CURRENCY) throw new Error('FX base currency is not AED');
  const raw = data.rates;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('FX rates missing');
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('FX rates contain an invalid value');
    }
  }
  const all = raw as Record<string, number>;
  if (all[BASE_CURRENCY] !== 1) throw new Error('FX AED rate must be exactly 1');
  const rates: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCIES) if (code in all) rates[code] = all[code];
  if (Object.keys(rates).length < 2) throw new Error('FX payload has no supported currencies');
  const unix = data.time_last_update_unix;
  if (typeof unix !== 'number' || !Number.isFinite(unix) || unix <= 0) {
    throw new Error('FX update time missing');
  }
  return { rates, providerUpdatedAt: new Date(unix * 1000) };
}

export class ExchangeRateApiProvider implements FxProvider {
  readonly source = 'ExchangeRate-API';
  readonly attribution = 'Rates by ExchangeRate-API';

  constructor(
    private readonly url: string,
    private readonly apiKey: string | undefined,
    private readonly fetcher: FetchLike = globalThis.fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  async fetchRates(): Promise<FxSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // The key (if any) is substituted into a `{key}` placeholder; the URL is never logged.
      const url = this.apiKey ? this.url.replace('{key}', encodeURIComponent(this.apiKey)) : this.url;
      const response = await this.fetcher(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`FX provider responded with HTTP ${response.status}`);
      return parseExchangeRatePayload(await response.json());
    } finally {
      clearTimeout(timer);
    }
  }
}
