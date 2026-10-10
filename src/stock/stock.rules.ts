/**
 * Pure stock rules (no I/O, no Nest): effective capacity, day and item status, range expansion, the cancellation
 * restock decision and alert de-duplication. `StockService` is the only place that feeds them data, so every number
 * in the admin screens, the public site and the oversell guard comes from the same derivation.
 */
import {
  addDays,
  bookingDeadlineUtc,
  isValidIsoDate,
  OPERATING_TZ_OFFSET_HOURS,
  serviceStartUtc,
  weekdayOf,
  type OptionRules,
} from '../catalog/activity-booking.utils';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  DEFAULT_RESTOCK_CUTOFF_HOURS,
  LOW_STOCK_LOOKAHEAD_DAYS,
  MAX_RANGE_DAYS,
  type CapacitySource,
  type DayStatus,
  type ItemStatus,
} from './stock.types';

const HOUR_MS = 3_600_000;

export interface DayOverride {
  capacity: number | null;
  closed: boolean;
  note: string;
}

/** Date override > policy default > legacy option.dailyCapacity > unlimited (null). */
export function effectiveCapacity(input: {
  override?: Pick<DayOverride, 'capacity'> | null;
  defaultCapacity?: number | null;
  legacyCapacity?: number | null;
}): { capacity: number | null; source: CapacitySource } {
  if (typeof input.override?.capacity === 'number') return { capacity: input.override.capacity, source: 'override' };
  if (typeof input.defaultCapacity === 'number') return { capacity: input.defaultCapacity, source: 'default' };
  if (typeof input.legacyCapacity === 'number') return { capacity: input.legacyCapacity, source: 'legacy' };
  return { capacity: null, source: 'unlimited' };
}

export interface DayInput {
  date: string;
  /** Today in the operating time zone. */
  today: string;
  override?: DayOverride | null;
  defaultCapacity?: number | null;
  legacyCapacity?: number | null;
  stopSale?: boolean;
  lowStockThreshold?: number;
  sold: number;
  held: number;
  /** False when the product does not run that day (weekday, blackout, no departure, booking deadline passed). */
  operational: boolean;
}

export interface DayFigures {
  date: string;
  capacity: number | null;
  capacitySource: CapacitySource;
  sold: number;
  held: number;
  available: number | null;
  closed: boolean;
  status: DayStatus;
  note: string;
}

/** The status of one item on one day, from its already counted units. */
export function computeDay(input: DayInput): DayFigures {
  const { capacity, source } = effectiveCapacity(input);
  const used = input.sold + input.held;
  const available = capacity === null ? null : Math.max(0, capacity - used);
  const threshold = input.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const closed = Boolean(input.override?.closed);
  let status: DayStatus;
  if (input.date < input.today) status = 'past';
  else if (!input.operational) status = 'non_operational';
  else if (closed || input.stopSale) status = 'closed';
  else if (available === null) status = 'unlimited';
  else if (available <= 0) status = 'sold_out';
  else if (available <= threshold) status = 'low';
  else status = 'ok';
  return {
    date: input.date,
    capacity,
    capacitySource: source,
    sold: input.sold,
    held: input.held,
    available,
    closed,
    status,
    note: input.override?.note ?? '',
  };
}

/** Days that can be booked right now (not closed, not sold out). */
export const isBookableStatus = (status: DayStatus) => status === 'unlimited' || status === 'ok' || status === 'low';
const isOperationalStatus = (status: DayStatus) => status !== 'past' && status !== 'non_operational';

export interface WindowSummary {
  capacityTotal: number | null;
  soldTotal: number;
  heldTotal: number;
  availableTotal: number | null;
  lowestRemaining: number | null;
  nextSoldOutDate: string | null;
  status: ItemStatus;
}

/**
 * Totals and the item status over a window of days. `capacityTotal` and `availableTotal` are null when no operational
 * day has a finite capacity; otherwise they add up the finite days (closed days add no availability).
 */
export function summarizeWindow(
  days: readonly DayFigures[],
  item: { stopSale?: boolean; defaultCapacity?: number | null; legacyCapacity?: number | null },
): WindowSummary {
  const operational = days.filter((day) => isOperationalStatus(day.status));
  const finite = operational.filter((day) => day.capacity !== null);
  const capacityTotal = finite.length ? finite.reduce((sum, day) => sum + (day.capacity as number), 0) : null;
  const availableTotal = finite.length
    ? finite.reduce((sum, day) => sum + (day.status === 'closed' ? 0 : (day.available as number)), 0)
    : null;
  const countable = finite.filter((day) => day.status !== 'closed');
  const lowestRemaining = countable.length ? Math.min(...countable.map((day) => day.available as number)) : null;
  const nextSoldOutDate = operational.find((day) => day.status === 'sold_out')?.date ?? null;

  let status: ItemStatus;
  const open = operational.filter((day) => day.status !== 'closed');
  if (item.stopSale) status = 'closed';
  else if (operational.length > 0 && open.length === 0) status = 'closed';
  else if (open.length > 0 && open.every((day) => day.status === 'sold_out')) status = 'sold_out';
  else if (open.some((day) => day.status === 'low' || day.status === 'sold_out')) status = 'low';
  else if (operational.length === 0) {
    status = typeof item.defaultCapacity === 'number' || typeof item.legacyCapacity === 'number' ? 'ok' : 'unlimited';
  } else status = open.every((day) => day.status === 'unlimited') ? 'unlimited' : 'ok';

  return {
    capacityTotal,
    soldTotal: operational.reduce((sum, day) => sum + day.sold, 0),
    heldTotal: operational.reduce((sum, day) => sum + day.held, 0),
    availableTotal,
    lowestRemaining,
    nextSoldOutDate,
    status,
  };
}

export interface HorizonSummary {
  /** The product runs on at least one day in the horizon. */
  hasOperationalDay: boolean;
  /** Runs on some day but no day can be booked any more (sold out or closed). */
  exhausted: boolean;
  nextAvailableDate: string | null;
  /** Lowest remaining within the low-stock look-ahead, only when it is at or under the threshold. */
  lowStock: boolean;
  lowestRemaining: number | null;
}

export function summarizeHorizon(days: readonly DayFigures[], today: string): HorizonSummary {
  const operational = days.filter((day) => isOperationalStatus(day.status));
  const bookable = operational.filter((day) => isBookableStatus(day.status));
  const lookahead = addDays(today, LOW_STOCK_LOOKAHEAD_DAYS - 1);
  const low = bookable.filter((day) => day.status === 'low' && day.date <= lookahead);
  const remaining = low.length ? Math.min(...low.map((day) => day.available as number)) : null;
  return {
    hasOperationalDay: operational.length > 0,
    exhausted: operational.length > 0 && bookable.length === 0,
    nextAvailableDate: bookable[0]?.date ?? null,
    lowStock: low.length > 0,
    lowestRemaining: remaining,
  };
}

export interface ProductStockStatus {
  soldOut: boolean;
  lowStock: boolean;
  nextAvailableDate: string | null;
  lowestRemaining: number | null;
}

/** Product level flags from its variants: sold out only when EVERY variant that runs is exhausted. */
export function combineVariants(variants: readonly HorizonSummary[]): ProductStockStatus {
  const soldOut = variants.length > 0 && variants.every((variant) => variant.exhausted);
  const next = variants.map((variant) => variant.nextAvailableDate).filter((date): date is string => date !== null).sort();
  const remaining = variants
    .map((variant) => variant.lowestRemaining)
    .filter((value): value is number => value !== null);
  return {
    soldOut,
    lowStock: variants.some((variant) => variant.lowStock),
    nextAvailableDate: next[0] ?? null,
    lowestRemaining: remaining.length ? Math.min(...remaining) : null,
  };
}

/** Sold-out / low-stock flags as the public detail pages show them (missing flags mean "not restricted"). */
export function publicStock(status?: Partial<ProductStockStatus> | null) {
  return {
    soldOut: Boolean(status?.soldOut),
    lowStock: Boolean(status?.lowStock),
    nextAvailableDate: status?.nextAvailableDate ?? null,
  };
}

export const sameStockStatus = (a?: Partial<ProductStockStatus> | null, b?: Partial<ProductStockStatus> | null) =>
  Boolean(a) &&
  Boolean(b) &&
  Boolean(a!.soldOut) === Boolean(b!.soldOut) &&
  Boolean(a!.lowStock) === Boolean(b!.lowStock) &&
  (a!.nextAvailableDate ?? null) === (b!.nextAvailableDate ?? null) &&
  (a!.lowestRemaining ?? null) === (b!.lowestRemaining ?? null);

// ------------------------------------------------------------------ operating days

/** Activity option schedule: weekday, blackout dates and the booking deadline (cutoff before the start). */
export function activityOperational(option: OptionRules, date: string, now: Date): boolean {
  if (!option.operatingWeekdays.includes(weekdayOf(date)) || option.blackoutDates?.includes(date)) return false;
  return now.getTime() < bookingDeadlineUtc(date, option).getTime();
}

/** Calendar day (operating time zone) of an instant, e.g. an event session start. */
export function operatingDayOf(instant: Date): string {
  return new Date(instant.getTime() + OPERATING_TZ_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
}

/** What a booking does to stock, for the admin booking view. */
export function bookingStockView(booking: {
  status: string;
  quantity: number;
  stockReleased?: boolean;
  holdExpiresAt?: Date | null;
}, now: Date): { returnable: boolean; held: number; used: number; returned: number; state: 'held' | 'used' | 'returned' | 'none'; released: boolean } {
  const q = booking.quantity;
  const gone = booking.status === 'cancelled' || booking.status === 'refunded';
  const held = booking.status === 'pending_payment' && booking.holdExpiresAt && booking.holdExpiresAt.getTime() > now.getTime() ? q : 0;
  const used = booking.status === 'confirmed' || booking.status === 'cancellation_requested' || (gone && booking.stockReleased === false) ? q : 0;
  const returned = gone && booking.stockReleased === true ? q : 0;
  return {
    returnable: gone && booking.stockReleased === false,
    held,
    used,
    returned,
    state: held ? 'held' : used ? 'used' : returned ? 'returned' : 'none',
    released: booking.stockReleased === true,
  };
}

// ------------------------------------------------------------------ ranges and edits

export type RangeProblem = 'INVALID_DATE' | 'INVALID_RANGE' | 'RANGE_TOO_LARGE' | 'NO_MATCHING_DAYS';

/** Every date in [from, to], optionally only the given weekdays (0 = Sunday). Throws `{ code }` on a bad range. */
export function expandDates(from: string, to: string, weekdays?: readonly number[]): string[] {
  const fail = (code: RangeProblem): never => {
    throw Object.assign(new Error(code), { code });
  };
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return fail('INVALID_DATE');
  if (to < from) return fail('INVALID_RANGE');
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_RANGE_DAYS) return fail('RANGE_TOO_LARGE');
  }
  const wanted = weekdays?.length ? new Set(weekdays) : null;
  const matching = wanted ? dates.filter((date) => wanted.has(weekdayOf(date))) : dates;
  if (!matching.length) return fail('NO_MATCHING_DAYS');
  return matching;
}

export type DayEditMode = 'set' | 'add' | 'remove';

/**
 * New day capacity for an edit. `set` writes the absolute number; `add`/`remove` move the effective capacity
 * (not possible while it is unlimited, since there is nothing to add to).
 */
export function applyCapacityEdit(
  mode: DayEditMode,
  effective: number | null,
  amount: number,
): number | null {
  if (mode === 'set') return amount;
  if (effective === null) return null;
  return mode === 'add' ? effective + amount : Math.max(0, effective - amount);
}

// ------------------------------------------------------------------ cancellation restock

export interface RestockDecision {
  restock: boolean;
  cutoffAt: Date;
}

/**
 * Units go back to stock when the cancellation (or full refund) happens before the cutoff: `cutoffHours` before
 * the service start (the start of the service day when there is no clean start time). Unset cutoff = 24 hours.
 */
export function restockDecision(input: {
  now: Date;
  serviceDay: string;
  startTime?: string | null;
  cutoffHours?: number | null;
}): RestockDecision {
  const hours = input.cutoffHours ?? DEFAULT_RESTOCK_CUTOFF_HOURS;
  const cutoffAt = new Date(serviceStartUtc(input.serviceDay, input.startTime).getTime() - hours * HOUR_MS);
  return { restock: input.now.getTime() <= cutoffAt.getTime(), cutoffAt };
}

// ------------------------------------------------------------------ alerts

export type AlertState = 'low' | 'sold_out';

export interface AlertCandidate {
  date: string;
  state: AlertState;
}

export const alertKey = (date: string, state: AlertState) => `${date}|${state}`;

/** The alert-worthy dates of a window: low or sold out. */
export function alertCandidates(days: readonly DayFigures[]): AlertCandidate[] {
  return days.flatMap((day) =>
    day.status === 'low' || day.status === 'sold_out' ? [{ date: day.date, state: day.status }] : [],
  );
}

/**
 * Compares what is alert-worthy now with the alerts already sent (`existing`, as `alertKey`s).
 * - `create`: states reached for the first time, to be alerted exactly once;
 * - `remove`: sent alerts whose state no longer holds (recovered, or the day passed), so a later relapse alerts again.
 * A day that moved from low to sold out keeps its `low` record, so selling back to low does not repeat the low alert.
 */
export function diffAlerts(
  existing: ReadonlySet<string>,
  candidates: readonly AlertCandidate[],
  today: string,
): { create: AlertCandidate[]; remove: string[] } {
  const wanted = new Set(candidates.map((c) => alertKey(c.date, c.state)));
  for (const candidate of candidates) {
    if (candidate.state === 'sold_out') wanted.add(alertKey(candidate.date, 'low'));
  }
  const create = candidates.filter((c) => !existing.has(alertKey(c.date, c.state)));
  const remove = [...existing].filter((key) => !wanted.has(key) || key.split('|')[0] < today);
  return { create, remove };
}
