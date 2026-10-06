/**
 * Pure rules for the admin dashboard and reports: range resolution (Asia/Dubai calendar days),
 * previous-period maths, zero-filled day buckets, delta/rate helpers and the rule-based insights.
 * No I/O, so everything here is unit tested. Money is plain AED numbers rounded to 2 decimals.
 */
import { appError } from '../common/app-error';
import { dayStartUtc, daysBetween, dubaiDay } from '../finance/finance-rules';

export const RANGE_PRESETS = ['7d', '30d', '90d', 'ytd'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface DayWindow {
  from: string;
  to: string;
  days: string[];
  /** Start of the first day (inclusive), as a UTC instant. */
  start: Date;
  /** Start of the day after the last day (exclusive). */
  end: Date;
}

export interface ResolvedRange extends DayWindow {
  key: RangePreset | 'custom';
  /** "30 days", "year to date (278 days)", "12 days" - used in sentences. */
  label: string;
  previous: DayWindow;
}

export const addDays = (day: string, offset: number): string =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() + offset * DAY_MS).toISOString().slice(0, 10);

export function windowFor(from: string, to: string): DayWindow {
  const days = daysBetween(from, to);
  return { from, to, days, start: dayStartUtc(from), end: new Date(dayStartUtc(to).getTime() + DAY_MS) };
}

/** The window of equal length that ends the day before `from`. */
export function previousWindow(from: string, to: string): DayWindow {
  const length = daysBetween(from, to).length;
  const prevTo = addDays(from, -1);
  return windowFor(addDays(prevTo, -(length - 1)), prevTo);
}

/** Accepts YYYY-MM-DD or a full ISO instant (converted to its Dubai day). */
export function toDubaiDay(value: string): string {
  if (DAY.test(value)) {
    if (Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) throw appError(400, 'INVALID_RANGE', `${value} is not a valid date`);
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw appError(400, 'INVALID_RANGE', `${value} is not a valid date`);
  return dubaiDay(date);
}

export interface RangeInput {
  range?: string;
  from?: string;
  to?: string;
}

/**
 * `from`/`to` (custom) win over `range`. Presets end today (Asia/Dubai, inclusive): 7d/30d/90d are the
 * last N days including today, ytd runs from 1 January. A custom range is at most 366 days.
 */
export function resolveRange(input: RangeInput, now = new Date()): ResolvedRange {
  const today = dubaiDay(now);
  let key: ResolvedRange['key'];
  let from: string;
  let to: string;
  if (input.from || input.to) {
    key = 'custom';
    to = input.to ? toDubaiDay(input.to) : today;
    from = input.from ? toDubaiDay(input.from) : addDays(to, -29);
  } else {
    const preset = (input.range ?? '30d') as RangePreset;
    if (!RANGE_PRESETS.includes(preset)) throw appError(400, 'INVALID_RANGE', `range must be one of ${RANGE_PRESETS.join(', ')}`);
    key = preset;
    to = today;
    from = preset === 'ytd' ? `${today.slice(0, 4)}-01-01` : addDays(today, -(Number(preset.slice(0, -1)) - 1));
  }
  if (from > to) throw appError(400, 'INVALID_RANGE', 'from must not be after to');
  const window = windowFor(from, to);
  if (window.days.length > MAX_RANGE_DAYS) {
    throw appError(400, 'RANGE_TOO_LARGE', `Choose a range of at most ${MAX_RANGE_DAYS} days`);
  }
  const n = window.days.length;
  const label = key === 'ytd' ? `year to date (${n} day${n === 1 ? '' : 's'})` : `${n} day${n === 1 ? '' : 's'}`;
  return { ...window, key, label, previous: previousWindow(from, to) };
}

/** Day buckets: one value per day of the window, zero where nothing happened. */
export function zeroFill(days: readonly string[], values: ReadonlyMap<string, number> | Record<string, number>): number[] {
  const get = values instanceof Map ? (d: string) => values.get(d) : (d: string) => (values as Record<string, number>)[d];
  return days.map((d) => get(d) ?? 0);
}

/** Buckets instants into Dubai days (used for tests and for sources that are not aggregated in the database). */
export function bucketDates(days: readonly string[], dates: readonly Date[]): number[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const day = dubaiDay(date);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return zeroFill(days, counts);
}

export const round2 = (n: number): number => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
export const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export type DeltaState = 'up' | 'down' | 'flat' | 'new' | 'none';

export interface Compare {
  value: number;
  previous: number;
  /** Percent change on the previous period, one decimal; null when the previous period is 0. */
  deltaPct: number | null;
  /** `new` = previous was 0 and now there is something; `none` = both 0. */
  state: DeltaState;
}

/** Percent change; null (never Infinity) when the previous value is 0. */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function compare(current: number, previous: number): Compare {
  const pct = deltaPct(current, previous);
  let state: DeltaState;
  if (!previous) state = current ? 'new' : 'none';
  else if (pct === 0) state = 'flat';
  else state = (pct as number) > 0 ? 'up' : 'down';
  return { value: current, previous, deltaPct: pct, state };
}

/** A percentage 0..100 with one decimal; null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export interface RateCompare {
  value: number | null;
  previous: number | null;
  /** Difference in percentage points; null unless both periods have a rate. */
  deltaPts: number | null;
  state: DeltaState;
  numerator: number;
  denominator: number;
  previousNumerator: number;
  previousDenominator: number;
}

export function compareRates(part: number, whole: number, prevPart: number, prevWhole: number): RateCompare {
  const value = rate(part, whole);
  const previous = rate(prevPart, prevWhole);
  const deltaPts = value !== null && previous !== null ? Math.round((value - previous) * 10) / 10 : null;
  let state: DeltaState = 'none';
  if (value !== null && previous === null) state = 'new';
  else if (deltaPts !== null) state = deltaPts === 0 ? 'flat' : deltaPts > 0 ? 'up' : 'down';
  return { value, previous, deltaPts, state, numerator: part, denominator: whole, previousNumerator: prevPart, previousDenominator: prevWhole };
}

/** "Sandhani Sekar" -> "Sandhani S."; no PII beyond first name and last initial. */
export function shortName(name: string | undefined | null): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Guest';
  if (parts.length === 1) return parts[0].slice(0, 24);
  return `${parts[0].slice(0, 24)} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// ---------------------------------------------------------------- insights

export interface Insight {
  id: string;
  severity: 'info' | 'warn';
  text: string;
  href: string;
}

export interface InsightInput {
  rangeLabel: string;
  /** Present only when the caller may see revenue. */
  revenue?: { value: number; previous: number };
  bookings?: { value: number; previous: number; pendingCancellationRequests: number };
  tickets?: { overdue: number; sla?: { compliance: number | null; evaluated: number; met: number } };
  leads?: { overdueFollowUps: number; unassignedOpen: number };
  excludedNonAed?: number;
}

/** Revenue moves smaller than this are described as steady. */
export const STEADY_BAND_PCT = 2;
export const SLA_WARN_BELOW_PCT = 80;
export const SLA_MIN_SAMPLE = 5;

export const formatAed = (value: number): string =>
  `AED ${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Rule-based sentences from real numbers only. Warnings (things that need a person) come with a link to
 * the page that fixes them. Nothing here is generated by a model.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const previousLabel = `the previous ${input.rangeLabel}`;

  if (input.revenue) {
    const { value, previous } = input.revenue;
    const c = compare(value, previous);
    let text: string;
    if (c.state === 'none') text = `No confirmed revenue in these ${input.rangeLabel}`;
    else if (c.state === 'new') text = `Revenue is ${formatAed(value)}, new against ${previousLabel} (none then)`;
    else if (value === 0) text = `No confirmed revenue in these ${input.rangeLabel}, down from ${formatAed(previous)} in ${previousLabel}`;
    else if (Math.abs(c.deltaPct ?? 0) < STEADY_BAND_PCT) text = `Revenue is ${formatAed(value)}, steady on ${previousLabel}`;
    else text = `Revenue is ${formatAed(value)}, ${(c.deltaPct as number) > 0 ? 'up' : 'down'} ${Math.abs(Math.round(c.deltaPct as number))}% on ${previousLabel}`;
    out.push({ id: 'revenue', severity: 'info', text, href: '/admin/reports/sales' });
  } else if (input.bookings) {
    const { value, previous } = input.bookings;
    const c = compare(value, previous);
    const text =
      c.state === 'none'
        ? `No bookings were created in these ${input.rangeLabel}`
        : c.state === 'new'
          ? `${plural(value, 'booking')} created, new against ${previousLabel} (none then)`
          : `${plural(value, 'booking')} created, ${Math.abs(c.deltaPct ?? 0) < STEADY_BAND_PCT ? 'steady on' : (c.deltaPct as number) > 0 ? `up ${Math.abs(Math.round(c.deltaPct as number))}% on` : `down ${Math.abs(Math.round(c.deltaPct as number))}% on`} ${previousLabel}`;
    out.push({ id: 'bookings', severity: 'info', text, href: '/admin/bookings' });
  }

  if (input.bookings && input.bookings.pendingCancellationRequests > 0) {
    const n = input.bookings.pendingCancellationRequests;
    out.push({ id: 'cancellation-requests', severity: 'warn', text: `${plural(n, 'cancellation request')} waiting for a decision`, href: '/admin/bookings/cancellations' });
  }
  if (input.tickets && input.tickets.overdue > 0) {
    const n = input.tickets.overdue;
    out.push({ id: 'tickets-overdue', severity: 'warn', text: `${plural(n, 'ticket')} past ${n === 1 ? 'its' : 'their'} SLA target`, href: '/admin/tickets?tab=overdue' });
  }
  const sla = input.tickets?.sla;
  if (sla && sla.compliance !== null && sla.evaluated >= SLA_MIN_SAMPLE && sla.compliance < SLA_WARN_BELOW_PCT) {
    out.push({ id: 'sla-low', severity: 'warn', text: `First-response SLA was met on ${sla.met} of ${sla.evaluated} tickets (${sla.compliance}%)`, href: '/admin/reports/support' });
  }
  if (input.leads && input.leads.overdueFollowUps > 0) {
    const n = input.leads.overdueFollowUps;
    out.push({ id: 'leads-overdue', severity: 'warn', text: `${plural(n, 'lead follow-up')} overdue`, href: '/admin/leads?followUp=overdue' });
  }
  if (input.leads && input.leads.unassignedOpen > 0) {
    const n = input.leads.unassignedOpen;
    out.push({ id: 'leads-unassigned', severity: 'info', text: `${plural(n, 'open lead')} without an owner`, href: '/admin/leads?owner=unassigned' });
  }
  if (input.excludedNonAed && input.excludedNonAed > 0) {
    const n = input.excludedNonAed;
    out.push({ id: 'non-aed', severity: 'info', text: `${plural(n, 'confirmed booking')} in another currency ${n === 1 ? 'is' : 'are'} not counted in AED revenue`, href: '/admin/bookings' });
  }
  return out;
}

export interface DashboardSummary {
  headline: string;
  attention: { text: string; href: string; id: string }[];
}

/** One sentence the dashboard shows: the first info insight as the headline, every warning as a link. */
export function buildSummary(insights: readonly Insight[]): DashboardSummary {
  const headline = insights.find((i) => i.id === 'revenue' || i.id === 'bookings')?.text ?? 'Not enough data yet to summarise this period';
  return {
    headline,
    attention: insights.filter((i) => i.severity === 'warn').map((i) => ({ id: i.id, text: i.text, href: i.href })),
  };
}

// ---------------------------------------------------------------- cache

/** Tiny TTL cache (default 60 s) with a size cap; the key must contain every input that changes the answer. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  constructor(
    private readonly ttlMs = 60_000,
    private readonly maxEntries = 200,
  ) {}

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.entries.size >= this.maxEntries) {
      for (const [k, v] of this.entries) if (v.expiresAt <= now) this.entries.delete(k);
      while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }
}

/** Cache key: the window plus the sorted permissions that shape the payload (never the user). */
export function cacheKey(range: Pick<DayWindow, 'from' | 'to'>, permissions: readonly string[]): string {
  return `${range.from}|${range.to}|${[...permissions].sort().join(',')}`;
}
