import {
  BASE_CURRENCY,
  CONVERTIBLE_ROUTE_PREFIXES,
  EXCLUDED_ROUTE_SEGMENTS,
  SUPPORTED_CURRENCIES,
} from './currency.constants';

/** Pure helpers: no I/O, no Nest imports, so they are trivially unit-testable. */

export type RateMap = Readonly<Record<string, number>>;

export interface Money {
  amount: number;
  currency: string;
  [key: string]: unknown;
}

export interface ConversionContext {
  target: string;
  rates: RateMap;
  markupPercent: number;
}

/** Upper-cases and validates a requested code; unsupported / malformed input yields null (ignored). */
export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(code) ? code : null;
}

/** `path` may include the global prefix and a query string; `prefix` is the global prefix (e.g. `api/v1`). */
export function isConvertibleRoute(method: string, path: string, prefix = ''): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const prefixSegments = prefix.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const segments = path
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  const rest = prefixSegments.every((p, i) => segments[i] === p)
    ? segments.slice(prefixSegments.length)
    : segments;
  if (!rest.length || !CONVERTIBLE_ROUTE_PREFIXES.includes(rest[0])) return false;
  return !rest.some((segment) => EXCLUDED_ROUTE_SEGMENTS.includes(segment));
}

const digitsCache = new Map<string, number>();

/** Minor-unit digits for a currency (JPY 0, USD 2, KWD 3) from Intl. */
export function fractionDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    digitsCache.set(currency, digits);
  }
  return digits;
}

export function roundToMinorUnits(value: number, currency: string): number {
  const factor = 10 ** fractionDigits(currency);
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A plain object with numeric `amount` and string `currency` (extra keys allowed). */
export function isMoney(value: unknown): value is Money {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.amount === 'number' &&
    Number.isFinite(value.amount) &&
    typeof value.currency === 'string'
  );
}

/**
 * Cross-rate through AED: amount / rate[from] * rate[to], optional markup for non-AED targets,
 * rounded to the target's minor units. Returns null when either currency has no rate.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: RateMap,
  markupPercent = 0,
): number | null {
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!(fromRate > 0) || !(toRate > 0)) return null;
  const markup = to === BASE_CURRENCY ? 1 : 1 + markupPercent / 100;
  return roundToMinorUnits((amount / fromRate) * toRate * markup, to);
}

function walk(value: unknown, ctx: ConversionContext): unknown {
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    value.forEach((item, i) => {
      const next = walk(item, ctx);
      if (next !== item) {
        copy ??= value.slice();
        copy[i] = next;
      }
    });
    return copy ?? value;
  }
  if (!isPlainObject(value)) return value;

  if (isMoney(value)) {
    const from = value.currency.toUpperCase();
    if (from === ctx.target) return value;
    const converted = convertAmount(value.amount, from, ctx.target, ctx.rates, ctx.markupPercent);
    return converted === null ? value : { ...value, amount: converted, currency: ctx.target };
  }

  let copy: Record<string, unknown> | null = null;
  for (const key of Object.keys(value)) {
    const next = walk(value[key], ctx);
    if (next !== value[key]) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  return copy ?? value;
}

/**
 * Walks plain objects/arrays and converts every Money. Returns the same reference when nothing
 * changed. Non-plain objects (ObjectId, Date, Buffer...) and bare numbers are never touched.
 */
export function convertPayload<T>(value: T, ctx: ConversionContext): T {
  return walk(value, ctx) as T;
}

/** Conversion is active only for a supported target that has a rate (AED present as the pivot). */
export function isConversionActive(target: string | null, rates: RateMap): target is string {
  return !!target && rates[target] > 0 && rates[BASE_CURRENCY] === 1;
}

/**
 * Applies conversion to a whole response body and fixes the top-level `currency` echo that modules
 * emit from the query string: the target when conversion is active, otherwise AED.
 */
export function convertResponseBody<T>(
  body: T,
  target: string | null,
  rates: RateMap,
  markupPercent: number,
): { body: T; active: boolean } {
  const active = isConversionActive(target, rates);
  let result: unknown = body;
  if (active) result = convertPayload(body, { target, rates, markupPercent });
  if (isPlainObject(result) && !isMoney(result) && typeof result.currency === 'string') {
    const echo = active ? target : BASE_CURRENCY;
    if (result.currency !== echo) result = { ...result, currency: echo };
  }
  return { body: result as T, active };
}

/** Stale when the provider timestamp is missing or older than maxAgeHours. */
export function isStale(updatedAt: Date | null, now: Date, maxAgeHours: number): boolean {
  if (!updatedAt) return true;
  return now.getTime() - updatedAt.getTime() > maxAgeHours * 3_600_000;
}
