// Search, visibility, slug and reference helpers are shared with the visas and holidays features.
import { buildSearchRegex, generateReference } from '../visas/visas.utils';

export {
  buildSearchRegex,
  ENQUIRY_STATUSES,
  isNotPastDate,
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
} from '../visas/visas.utils';
export type { EnquiryStatus } from '../visas/visas.utils';

export const CRUISE_SORTS = [
  'popular',
  'price_asc',
  'price_desc',
  'nights_asc',
  'nights_desc',
  'soonest',
] as const;
export type CruiseSort = (typeof CRUISE_SORTS)[number];

export const ITINERARY_TYPES = ['port', 'sea', 'embark', 'disembark'] as const;
export type ItineraryType = (typeof ITINERARY_TYPES)[number];

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_DEPARTURES = 60;
export const NEXT_DEPARTURES = 4;
export const PORT_PREVIEW = 6;
export const SEA_DAY_LABEL = 'At Sea';

export const CRUISE_REFERENCE_PATTERN = /^CQ-[A-Z2-7]{8}$/;

/** `CQ-` plus 8 crypto-random base32 characters. */
export function generateCruiseReference(): string {
  return generateReference('CQ');
}

export interface Money {
  amount: number;
  currency: string;
}

/** Start of the current UTC calendar day: the earliest departure that is still "upcoming". */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** `YYYY-MM-DD` (UTC) for a date-like value. */
export function toIsoDate(value: Date | string | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Upcoming departures (on or after the start of today, UTC) as unique ascending ISO dates.
 * Invalid values are ignored.
 */
export function upcomingDepartures(
  departures: readonly (Date | string)[] | null | undefined,
  now: Date = new Date(),
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const floor = startOfTodayUtc(now).getTime();
  const days = new Set<string>();
  for (const value of departures ?? []) {
    const time = new Date(value).getTime();
    if (!Number.isNaN(time) && time >= floor) days.add(toIsoDate(time));
  }
  return [...days].sort().slice(0, limit);
}

/** True when `value` falls on one of the cruise's upcoming departure days. */
export function isUpcomingDeparture(
  value: string,
  departures: readonly (Date | string)[] | null | undefined,
  now: Date = new Date(),
): boolean {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  return upcomingDepartures(departures, now).includes(toIsoDate(time));
}

/** Departure dates as unique, ascending UTC-midnight Dates (what is stored). */
export function normalizeDepartureDates(values: readonly string[] | undefined): Date[] {
  const days = new Set<string>();
  for (const value of values ?? []) {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) days.add(toIsoDate(time));
  }
  return [...days].sort().map((day) => new Date(`${day}T00:00:00.000Z`));
}

/** `[start, end)` UTC bounds of a `YYYY-MM` month, or null when the format is invalid. */
export function monthBounds(month: string): { start: Date; end: Date } | null {
  if (!MONTH_PATTERN.test(month)) return null;
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return { start: new Date(Date.UTC(year, index, 1)), end: new Date(Date.UTC(year, index + 1, 1)) };
}

interface PricedCruise {
  cabins?: { fromPrice?: Money | null }[] | null;
  price?: Money | null;
}

/** Lowest cabin "from" fare; falls back to the stored `price`. */
export function derivePrice(cruise: PricedCruise): Money | null {
  let lowest: Money | null = null;
  for (const cabin of cruise.cabins ?? []) {
    const fare = cabin.fromPrice;
    if (fare && typeof fare.amount === 'number' && (!lowest || fare.amount < lowest.amount)) {
      lowest = fare;
    }
  }
  const chosen = lowest ?? cruise.price ?? null;
  return chosen ? { amount: chosen.amount, currency: chosen.currency } : null;
}

/** First six stop names (sea days are "At Sea") and the total number of stops. */
export function derivePorts(
  itinerary: readonly { port?: string; type?: string }[] | null | undefined,
): { ports: string[]; portCount: number } {
  const stops = itinerary ?? [];
  return {
    ports: stops
      .slice(0, PORT_PREVIEW)
      .map((stop) => (stop.type === 'sea' ? SEA_DAY_LABEL : (stop.port ?? ''))),
    portCount: stops.length,
  };
}

/** `durationDays` defaults to nights + 1. */
export function resolveDurationDays(durationNights: number, durationDays?: number): number {
  return durationDays ?? durationNights + 1;
}

/** Returns an error message when the itinerary is inconsistent, otherwise null. */
export function validateItinerary(
  itinerary: readonly { day: number }[],
  durationDays: number,
): string | null {
  if (itinerary.length !== durationDays) {
    return `itinerary must have exactly ${durationDays} days (durationDays), got ${itinerary.length}`;
  }
  for (const [index, stop] of itinerary.entries()) {
    if (stop.day !== index + 1) {
      return 'itinerary days must be consecutive, starting at 1';
    }
  }
  return null;
}

export interface CruiseFilterInput {
  q?: string;
  city?: string;
  line?: string;
  region?: string;
  month?: string;
  minNights?: number;
  maxNights?: number;
}

/** Expression: the departures that are still upcoming. */
export function upcomingExpr(now: Date = new Date()) {
  return {
    $filter: {
      input: { $ifNull: ['$departures', []] },
      as: 'd',
      cond: { $gte: ['$$d', startOfTodayUtc(now)] },
    },
  };
}

/** Expression: lowest cabin fare, falling back to the stored price (mirrors `derivePrice`). */
export const PRICE_EXPR = { $ifNull: [{ $min: '$cabins.fromPrice.amount' }, '$price.amount'] };

/**
 * Builds the list filter. `base` is the visibility filter (empty for admin). Public queries
 * (`upcomingOnly`) only match cruises that still have an upcoming departure; with a month, that
 * departure must fall inside the month (and not before today).
 */
export function buildCruiseFilter(
  query: CruiseFilterInput,
  base: Record<string, unknown>,
  now: Date = new Date(),
  upcomingOnly = true,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...base };
  const q = query.q?.trim();
  if (q) {
    const pattern = buildSearchRegex(q);
    filter.$or = [
      { title: pattern },
      { shipName: pattern },
      { cruiseLine: pattern },
      { 'itinerary.port': pattern },
    ];
  }
  if (query.city) filter.departureCity = query.city;
  if (query.line) filter.cruiseLine = query.line;
  if (query.region) filter.region = query.region;
  if (query.minNights !== undefined || query.maxNights !== undefined) {
    const nights: Record<string, number> = {};
    if (query.minNights !== undefined) nights.$gte = query.minNights;
    if (query.maxNights !== undefined) nights.$lte = query.maxNights;
    filter.durationNights = nights;
  }

  const today = startOfTodayUtc(now);
  const bounds = query.month ? monthBounds(query.month) : null;
  if (bounds) {
    const start = upcomingOnly && bounds.start < today ? today : bounds.start;
    filter.departures = { $elemMatch: { $gte: start, $lt: bounds.end } };
  } else if (upcomingOnly) {
    filter.departures = { $gte: today };
  }
  return filter;
}

export interface CruiseSortSpec {
  /** Computed field needed for sorting, added before $sort. */
  addFields?: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
}

const FAR_FUTURE = new Date('9999-12-31T00:00:00.000Z');

/** Maps the public sort keyword to an aggregation sort. Cruises without a price/departure sort last. */
export function buildCruiseSort(sort: CruiseSort = 'popular', now: Date = new Date()): CruiseSortSpec {
  switch (sort) {
    case 'price_asc':
      return {
        addFields: { _sortPrice: { $ifNull: [PRICE_EXPR, Number.MAX_SAFE_INTEGER] } },
        sort: { _sortPrice: 1, popularity: -1, _id: 1 },
      };
    case 'price_desc':
      return {
        addFields: { _sortPrice: { $ifNull: [PRICE_EXPR, -1] } },
        sort: { _sortPrice: -1, popularity: -1, _id: 1 },
      };
    case 'nights_asc':
      return { sort: { durationNights: 1, popularity: -1, _id: 1 } };
    case 'nights_desc':
      return { sort: { durationNights: -1, popularity: -1, _id: 1 } };
    case 'soonest':
      return {
        addFields: { _next: { $ifNull: [{ $min: upcomingExpr(now) }, FAR_FUTURE] } },
        sort: { _next: 1, popularity: -1, _id: 1 },
      };
    case 'popular':
    default:
      return { sort: { popularity: -1, title: 1, _id: 1 } };
  }
}
