import {
  bookingDeadlineUtc,
  checkBookingRequest,
  computeDayStatus,
  daysOfMonth,
  freeCancellationUntil,
  isValidIsoDate,
  isValidMonth,
  operatingToday,
  pickShortcuts,
  serviceStartUtc,
  validateOptions,
  type OptionRules,
  type PaxRules,
} from './activity-booking.utils';

// Sunday 2026-10-04 12:00 in Dubai (UTC+4).
const NOW = new Date('2026-10-04T08:00:00.000Z');

const everyDay = [0, 1, 2, 3, 4, 5, 6];
const option = (over: Partial<OptionRules & PaxRules> = {}): OptionRules & PaxRules => ({
  operatingWeekdays: everyDay,
  blackoutDates: [],
  cutoffHours: 0,
  dailyCapacity: null,
  startTime: '19:00',
  minPax: 1,
  maxPax: 10,
  childPrice: { amount: 50, currency: 'AED' },
  ...over,
});

describe('date helpers', () => {
  it('validates ISO dates and months strictly', () => {
    expect(isValidIsoDate('2026-10-05')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
    expect(isValidIsoDate(20261005)).toBe(false);
    expect(isValidMonth('2026-12')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-00')).toBe(false);
  });

  it('computes the operating day in Dubai time, not UTC', () => {
    expect(operatingToday(new Date('2026-10-04T21:00:00.000Z'))).toBe('2026-10-05');
    expect(operatingToday(new Date('2026-10-04T19:59:00.000Z'))).toBe('2026-10-04');
  });

  it('lists the days of a month', () => {
    expect(daysOfMonth('2026-02')).toHaveLength(28);
    expect(daysOfMonth('2026-10')[30]).toBe('2026-10-31');
  });

  it('converts a start time to UTC and falls back to the start of the day', () => {
    expect(serviceStartUtc('2026-10-05', '19:00').toISOString()).toBe('2026-10-05T15:00:00.000Z');
    expect(serviceStartUtc('2026-10-05', 'Flexible').toISOString()).toBe('2026-10-04T20:00:00.000Z');
  });

  it('keeps same-day booking open without a start time and closes it before the cutoff otherwise', () => {
    expect(bookingDeadlineUtc('2026-10-04', { startTime: undefined, cutoffHours: 0 }).toISOString()).toBe(
      '2026-10-04T20:00:00.000Z',
    );
    expect(bookingDeadlineUtc('2026-10-05', { startTime: '19:00', cutoffHours: 6 }).toISOString()).toBe(
      '2026-10-05T09:00:00.000Z',
    );
  });
});

describe('computeDayStatus', () => {
  const status = (date: string, o: Partial<OptionRules> = {}, booked = 0, now = NOW) =>
    computeDayStatus({ date, option: option(o), now, booked });

  it('marks earlier days as past and later ones available', () => {
    expect(status('2026-10-03')).toBe('past');
    expect(status('2026-10-05')).toBe('available');
  });

  it('honours operating weekdays and blackout dates', () => {
    // 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
    expect(status('2026-10-05', { operatingWeekdays: [2, 3] })).toBe('non_operational');
    expect(status('2026-10-06', { operatingWeekdays: [2, 3] })).toBe('available');
    expect(status('2026-10-06', { blackoutDates: ['2026-10-06'] })).toBe('non_operational');
  });

  it('closes a day once the cutoff before the start has passed', () => {
    // Today 19:00 start, now 12:00 local: open with a 6 h cutoff, closed with an 8 h cutoff.
    expect(status('2026-10-04', { cutoffHours: 6 })).toBe('available');
    expect(status('2026-10-04', { cutoffHours: 8 })).toBe('past');
  });

  it('is sold out when confirmed bookings and holds use up the capacity', () => {
    expect(status('2026-10-05', { dailyCapacity: 10 }, 9)).toBe('available');
    expect(status('2026-10-05', { dailyCapacity: 10 }, 10)).toBe('sold_out');
    expect(status('2026-10-05', { dailyCapacity: 10 }, 12)).toBe('sold_out');
    expect(status('2026-10-05', { dailyCapacity: null }, 9999)).toBe('available');
  });

  it('reports non_operational before sold_out', () => {
    expect(status('2026-10-05', { dailyCapacity: 1, blackoutDates: ['2026-10-05'] }, 5)).toBe(
      'non_operational',
    );
  });
});

describe('checkBookingRequest', () => {
  const check = (over: Partial<Parameters<typeof checkBookingRequest>[0]> = {}) =>
    checkBookingRequest({
      option: option(),
      date: '2026-10-10',
      adults: 2,
      children: 0,
      now: NOW,
      booked: 0,
      ...over,
    });

  it('accepts a valid request', () => {
    expect(check()).toBeNull();
    expect(check({ children: 1 })).toBeNull();
  });

  it('rejects malformed and far-away dates', () => {
    expect(check({ date: 'tomorrow' })?.code).toBe('INVALID_DATE');
    expect(check({ date: '2028-01-01' })?.code).toBe('DATE_TOO_FAR');
  });

  it('enforces pax limits and child rules', () => {
    expect(check({ adults: 0 })?.code).toBe('PAX_LIMIT');
    expect(check({ option: option({ minPax: 2 }), adults: 1 })?.code).toBe('PAX_LIMIT');
    expect(check({ adults: 8, children: 3 })?.code).toBe('PAX_LIMIT');
    expect(check({ option: option({ childPrice: null }), children: 1 })).toMatchObject({
      code: 'CHILD_NOT_ALLOWED',
      status: 400,
    });
  });

  it('answers 409 DATE_UNAVAILABLE for closed days and for too little capacity', () => {
    expect(check({ date: '2026-10-01' })).toMatchObject({ code: 'DATE_UNAVAILABLE', status: 409 });
    expect(check({ option: option({ dailyCapacity: 10 }), booked: 9, adults: 2 })).toMatchObject({
      code: 'DATE_UNAVAILABLE',
      status: 409,
    });
    expect(check({ option: option({ dailyCapacity: 10 }), booked: 8, adults: 2 })).toBeNull();
  });
});

describe('freeCancellationUntil', () => {
  it('is the start minus the free-cancellation hours', () => {
    const until = freeCancellationUntil('2026-10-10', { refundable: true, freeCancellationHours: 24, startTime: '19:00' });
    expect(until?.toISOString()).toBe('2026-10-09T15:00:00.000Z');
  });

  it('falls back to the activity-level hours and is absent when non-refundable', () => {
    expect(freeCancellationUntil('2026-10-10', { refundable: true }, 48)?.toISOString()).toBe(
      '2026-10-07T20:00:00.000Z',
    );
    expect(freeCancellationUntil('2026-10-10', { refundable: false, freeCancellationHours: 24 })).toBeUndefined();
    expect(freeCancellationUntil('2026-10-10', { refundable: true })).toBeUndefined();
  });
});

describe('pickShortcuts', () => {
  it('returns the first available day and the first available Fri-Sun within a week', () => {
    const days = daysOfMonth('2026-10').map((date) => ({
      date,
      status: computeDayStatus({ date, option: option(), now: NOW, booked: 0 }),
    }));
    // Today (Sunday) counts as part of the weekend; it is still bookable at 12:00 for a 19:00 start.
    expect(pickShortcuts(days, NOW)).toEqual({ nextAvailable: '2026-10-04', thisWeekend: '2026-10-04' });
  });

  it('omits shortcuts when nothing is available', () => {
    const days = [{ date: '2026-10-05', status: 'sold_out' as const }];
    expect(pickShortcuts(days, NOW)).toEqual({});
  });

  it('skips unavailable weekend days', () => {
    const days = [
      { date: '2026-10-05', status: 'available' as const },
      { date: '2026-10-09', status: 'sold_out' as const },
      { date: '2026-10-10', status: 'available' as const },
    ];
    expect(pickShortcuts(days, NOW)).toEqual({ nextAvailable: '2026-10-05', thisWeekend: '2026-10-10' });
  });
});

describe('validateOptions', () => {
  const base = { id: 'a', ...option() };

  it('accepts consistent options', () => {
    expect(validateOptions([base, { ...base, id: 'b' }])).toBeNull();
  });

  it('rejects duplicate ids, inverted pax and bad weekdays/dates', () => {
    expect(validateOptions([base, base])).toMatch(/Duplicate/);
    expect(validateOptions([{ ...base, minPax: 5, maxPax: 2 }])).toMatch(/minPax/);
    expect(validateOptions([{ ...base, operatingWeekdays: [7] }])).toMatch(/operatingWeekdays/);
    expect(validateOptions([{ ...base, blackoutDates: ['2026-02-31'] }])).toMatch(/blackoutDates/);
  });
});
