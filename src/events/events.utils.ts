// Search, visibility, slug, date and reference helpers are shared with the cruises, visas and holidays features.
import { startOfTodayUtc, toIsoDate } from '../cruises/cruises.utils';
import type { Money } from '../cruises/cruises.utils';
import { buildSearchRegex, generateReference, slugify } from '../visas/visas.utils';

export {
  buildSearchRegex,
  ENQUIRY_STATUSES,
  isNotPastDate,
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
  startOfTodayUtc,
  toIsoDate,
} from '../cruises/cruises.utils';
export type { EnquiryStatus, Money } from '../cruises/cruises.utils';

export const EVENT_CATEGORIES = [
  'Concerts',
  'Sports',
  'Festivals',
  'Comedy',
  'Family',
  'Theatre',
  'Exhibitions',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_SORTS = ['soonest', 'popular', 'price_asc', 'price_desc'] as const;
export type EventSort = (typeof EVENT_SORTS)[number];

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SESSIONS = 60;

export const EVENT_REFERENCE_PATTERN = /^EQ-[A-Z2-7]{8}$/;

/** `EQ-` plus 8 crypto-random base32 characters. */
export function generateEventReference(): string {
  return generateReference('EQ');
}

const DAY_MS = 86_400_000;

/** Canonical category name for a name or slug (case-insensitive), or undefined when unknown. */
export function resolveCategory(input: string | undefined): EventCategory | undefined {
  const wanted = slugify(input ?? '');
  return EVENT_CATEGORIES.find((name) => slugify(name) === wanted);
}

/** `[start, end)` UTC bounds of a `YYYY-MM-DD` day, or null when it is not a real date. */
export function dayBounds(day: string): { start: Date; end: Date } | null {
  if (!DATE_PATTERN.test(day)) return null;
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || toIsoDate(start) !== day) return null;
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

interface RawSession {
  startsAt?: Date | string;
  doorsOpenAt?: Date | string | null;
  _id?: unknown;
}

/** Upcoming sessions (on or after the start of today, UTC), ascending by start time. Invalid values are ignored. */
export function upcomingSessions<T extends RawSession>(
  sessions: readonly T[] | null | undefined,
  now: Date = new Date(),
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const floor = startOfTodayUtc(now).getTime();
  const time = (s: T) => new Date(s.startsAt as Date | string).getTime();
  return (sessions ?? [])
    .filter((s) => !Number.isNaN(time(s)) && time(s) >= floor)
    .sort((a, b) => time(a) - time(b))
    .slice(0, limit);
}

/** True when `sessionId` belongs to one of the event's upcoming sessions. */
export function isUpcomingSessionId(
  sessionId: string,
  sessions: readonly RawSession[] | null | undefined,
  now: Date = new Date(),
): boolean {
  return upcomingSessions(sessions, now).some((s) => String(s._id) === sessionId);
}

export interface SessionInput {
  startsAt: string;
  doorsOpenAt?: string;
}

/** Sessions as unique (by start time), ascending: what is stored. */
export function normalizeSessions(
  values: readonly SessionInput[] | undefined,
): { startsAt: Date; doorsOpenAt?: Date }[] {
  const byStart = new Map<number, { startsAt: Date; doorsOpenAt?: Date }>();
  for (const value of values ?? []) {
    const startsAt = new Date(value.startsAt);
    if (Number.isNaN(startsAt.getTime())) continue;
    byStart.set(startsAt.getTime(), {
      startsAt,
      ...(value.doorsOpenAt ? { doorsOpenAt: new Date(value.doorsOpenAt) } : {}),
    });
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, session]) => session);
}

/** Error message when a session's doors open after it starts, otherwise null. */
export function validateSessions(values: readonly SessionInput[] | undefined): string | null {
  for (const value of values ?? []) {
    if (value.doorsOpenAt && Date.parse(value.doorsOpenAt) > Date.parse(value.startsAt)) {
      return 'doorsOpenAt must not be later than startsAt';
    }
  }
  return null;
}

interface PricedEvent {
  ticketTypes?: { price?: Money | null }[] | null;
  price?: Money | null;
}

/** Lowest ticket "from" price; falls back to the stored `price`. */
export function derivePrice(event: PricedEvent): Money | null {
  let lowest: Money | null = null;
  for (const ticket of event.ticketTypes ?? []) {
    const price = ticket.price;
    if (price && typeof price.amount === 'number' && (!lowest || price.amount < lowest.amount)) {
      lowest = price;
    }
  }
  const chosen = lowest ?? event.price ?? null;
  return chosen ? { amount: chosen.amount, currency: chosen.currency } : null;
}

/** Expression: the start times of the sessions that are still upcoming. */
export function upcomingStartsExpr(now: Date = new Date()) {
  return {
    $map: {
      input: {
        $filter: {
          input: { $ifNull: ['$sessions', []] },
          as: 's',
          cond: { $gte: ['$$s.startsAt', startOfTodayUtc(now)] },
        },
      },
      as: 's',
      in: '$$s.startsAt',
    },
  };
}

/** Expression: lowest ticket price, falling back to the stored price (mirrors `derivePrice`). */
export const PRICE_EXPR = { $ifNull: [{ $min: '$ticketTypes.price.amount' }, '$price.amount'] };

export interface EventFilterInput {
  q?: string;
  city?: string;
  category?: string;
  date?: string;
  from?: string;
  to?: string;
}

/**
 * Builds the list filter. `base` is the visibility filter (empty for admin). Public queries
 * (`upcomingOnly`) only match events with an upcoming session; `date`, `from` and `to` narrow that
 * to a session inside the window (never before today).
 */
export function buildEventFilter(
  query: EventFilterInput,
  base: Record<string, unknown>,
  now: Date = new Date(),
  upcomingOnly = true,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...base };
  const q = query.q?.trim();
  if (q) {
    const pattern = buildSearchRegex(q);
    filter.$or = [{ title: pattern }, { venue: pattern }, { city: pattern }, { tags: pattern }];
  }
  if (query.city) filter.city = query.city;
  if (query.category) filter.category = resolveCategory(query.category) ?? query.category;

  let lower: Date | undefined = upcomingOnly ? startOfTodayUtc(now) : undefined;
  let upper: Date | undefined;
  const notBefore = (value: Date) => {
    if (!lower || value > lower) lower = value;
  };
  const before = (value: Date) => {
    if (!upper || value < upper) upper = value;
  };
  const day = query.date ? dayBounds(query.date) : null;
  if (day) {
    notBefore(day.start);
    before(day.end);
  }
  const from = query.from ? dayBounds(query.from) : null;
  if (from) notBefore(from.start);
  const to = query.to ? dayBounds(query.to) : null;
  if (to) before(to.end);

  if (lower || upper) {
    filter.sessions = {
      $elemMatch: {
        startsAt: { ...(lower ? { $gte: lower } : {}), ...(upper ? { $lt: upper } : {}) },
      },
    };
  }
  return filter;
}

export interface EventSortSpec {
  /** Computed field needed for sorting, added before $sort. */
  addFields?: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
}

const FAR_FUTURE = new Date('9999-12-31T00:00:00.000Z');

/** Maps the public sort keyword to an aggregation sort. Events without a price/session sort last. */
export function buildEventSort(sort: EventSort = 'soonest', now: Date = new Date()): EventSortSpec {
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
    case 'popular':
      return { sort: { popularity: -1, title: 1, _id: 1 } };
    case 'soonest':
    default:
      return {
        addFields: { _next: { $ifNull: [{ $min: upcomingStartsExpr(now) }, FAR_FUTURE] } },
        sort: { _next: 1, popularity: -1, _id: 1 },
      };
  }
}
