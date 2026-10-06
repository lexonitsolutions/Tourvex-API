/**
 * Pure helpers for activity options: date/time handling, day status and request validation.
 * No I/O and no Nest imports so everything is unit-testable. Service dates are calendar days
 * (YYYY-MM-DD) in the operating time zone, Asia/Dubai (UTC+4, no DST).
 */

export const OPERATING_TZ_OFFSET_HOURS = 4;
export const BOOKING_WINDOW_DAYS = 365;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const TRANSFER_TYPES = ['sharing', 'private', 'none'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

export type DayStatus = 'available' | 'sold_out' | 'non_operational' | 'past';

export interface OptionRules {
  operatingWeekdays: number[];
  blackoutDates?: string[];
  cutoffHours?: number | null;
  dailyCapacity?: number | null;
  startTime?: string | null;
}

export interface PaxRules {
  minPax: number;
  maxPax: number;
  childPrice?: unknown;
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Today's calendar day in the operating time zone. */
export function operatingToday(now: Date): string {
  return new Date(now.getTime() + OPERATING_TZ_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** All calendar days of a `YYYY-MM` month. */
export function daysOfMonth(month: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Parses a display start time only when it is a clean "HH:mm"; anything else is "no time". */
export function parseStartTime(startTime?: string | null): { hours: number; minutes: number } | null {
  const match =
    typeof startTime === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime.trim()) : null;
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** UTC instant of the service start; start of the day when the option has no clean start time. */
export function serviceStartUtc(date: string, startTime?: string | null): Date {
  const [year, month, day] = date.split('-').map(Number);
  const time = parseStartTime(startTime) ?? { hours: 0, minutes: 0 };
  return new Date(
    Date.UTC(year, month - 1, day, time.hours, time.minutes) - OPERATING_TZ_OFFSET_HOURS * HOUR_MS,
  );
}

/**
 * Last instant a booking can be made: cutoff hours before the start. Without a clean start time
 * the reference is the end of the service day, so same-day booking stays possible with cutoff 0.
 */
export function bookingDeadlineUtc(
  date: string,
  option: Pick<OptionRules, 'startTime' | 'cutoffHours'>,
): Date {
  const reference = parseStartTime(option.startTime)
    ? serviceStartUtc(date, option.startTime)
    : new Date(serviceStartUtc(date).getTime() + DAY_MS);
  return new Date(reference.getTime() - (option.cutoffHours ?? 0) * HOUR_MS);
}

export function computeDayStatus(input: {
  date: string;
  option: OptionRules;
  now: Date;
  booked: number;
}): DayStatus {
  const { date, option, now, booked } = input;
  if (date < operatingToday(now)) return 'past';
  if (!option.operatingWeekdays.includes(weekdayOf(date)) || option.blackoutDates?.includes(date)) {
    return 'non_operational';
  }
  if (now.getTime() >= bookingDeadlineUtc(date, option).getTime()) return 'past';
  if (option.dailyCapacity != null && option.dailyCapacity - booked <= 0) return 'sold_out';
  return 'available';
}

export type BookingCheckCode =
  | 'INVALID_DATE'
  | 'DATE_TOO_FAR'
  | 'DATE_UNAVAILABLE'
  | 'PAX_LIMIT'
  | 'CHILD_NOT_ALLOWED';

export interface BookingCheckFailure {
  code: BookingCheckCode;
  message: string;
  /** HTTP status the service should answer with. */
  status: 400 | 409;
}

/** Validates date window, option availability, pax limits and child pricing. Null means OK. */
export function checkBookingRequest(input: {
  option: OptionRules & PaxRules;
  date: string;
  adults: number;
  children: number;
  now: Date;
  booked: number;
}): BookingCheckFailure | null {
  const { option, date, adults, children, now, booked } = input;
  if (!isValidIsoDate(date)) {
    return { code: 'INVALID_DATE', message: 'date must be a valid YYYY-MM-DD date', status: 400 };
  }
  if (date > addDays(operatingToday(now), BOOKING_WINDOW_DAYS)) {
    return { code: 'DATE_TOO_FAR', message: 'That date is too far in the future to book', status: 400 };
  }
  const pax = adults + children;
  if (adults < 1) return { code: 'PAX_LIMIT', message: 'At least one adult is required', status: 400 };
  if (children > 0 && option.childPrice == null) {
    return { code: 'CHILD_NOT_ALLOWED', message: 'This option does not accept children', status: 400 };
  }
  if (pax < option.minPax || pax > option.maxPax) {
    return {
      code: 'PAX_LIMIT',
      message: `This option accepts ${option.minPax} to ${option.maxPax} travellers per booking`,
      status: 400,
    };
  }
  const status = computeDayStatus({ date, option, now, booked });
  if (status !== 'available') {
    return {
      code: 'DATE_UNAVAILABLE',
      message: 'This option is not available on the selected date',
      status: 409,
    };
  }
  if (option.dailyCapacity != null && option.dailyCapacity - booked < pax) {
    return {
      code: 'DATE_UNAVAILABLE',
      message: 'There is not enough availability for that number of travellers on this date',
      status: 409,
    };
  }
  return null;
}

/** Deadline for a free cancellation, or undefined for non-refundable options. */
export function freeCancellationUntil(
  date: string,
  option: { refundable: boolean; freeCancellationHours?: number | null; startTime?: string | null },
  activityFreeCancellationHours?: number | null,
): Date | undefined {
  if (!option.refundable) return undefined;
  const hours = option.freeCancellationHours ?? activityFreeCancellationHours;
  if (hours == null) return undefined;
  return new Date(serviceStartUtc(date, option.startTime).getTime() - hours * HOUR_MS);
}

/**
 * Shortcuts for the date picker, computed over the days given: the first available day, and the
 * first available Friday/Saturday/Sunday within the next 7 days (today included).
 */
export function pickShortcuts(
  days: { date: string; status: DayStatus }[],
  now: Date,
): { nextAvailable?: string; thisWeekend?: string } {
  const available = days.filter((d) => d.status === 'available');
  const today = operatingToday(now);
  const horizon = addDays(today, 6);
  const nextAvailable = available[0]?.date;
  const thisWeekend = available.find(
    (d) => d.date >= today && d.date <= horizon && [5, 6, 0].includes(weekdayOf(d.date)),
  )?.date;
  return { ...(nextAvailable && { nextAvailable }), ...(thisWeekend && { thisWeekend }) };
}

export interface OptionLike extends OptionRules, PaxRules {
  id: string;
}

/** Cross-field rules the DTO cannot express. Returns the first problem or null. */
export function validateOptions(options: OptionLike[]): string | null {
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.id)) return `Duplicate option id "${option.id}"`;
    seen.add(option.id);
    if (option.minPax > option.maxPax) return `Option "${option.id}": minPax cannot exceed maxPax`;
    if (option.operatingWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return `Option "${option.id}": operatingWeekdays must be integers 0-6`;
    }
    if (option.blackoutDates?.some((d) => !isValidIsoDate(d))) {
      return `Option "${option.id}": blackoutDates must be YYYY-MM-DD`;
    }
  }
  return null;
}
