import {
  alertCandidates,
  alertKey,
  applyCapacityEdit,
  bookingStockView,
  combineVariants,
  computeDay,
  diffAlerts,
  effectiveCapacity,
  expandDates,
  operatingDayOf,
  publicStock,
  restockDecision,
  summarizeHorizon,
  summarizeWindow,
  type DayFigures,
} from './stock.rules';
import { formatItemId, parseItemId } from './stock.types';

const base = { today: '2030-01-10', sold: 0, held: 0, operational: true };
const day = (over: Partial<Parameters<typeof computeDay>[0]> & { date: string }) => computeDay({ ...base, ...over });

describe('effectiveCapacity', () => {
  it('prefers the date override, then the default, then the legacy option capacity, then unlimited', () => {
    expect(effectiveCapacity({ override: { capacity: 5 }, defaultCapacity: 10, legacyCapacity: 20 })).toEqual({ capacity: 5, source: 'override' });
    expect(effectiveCapacity({ override: { capacity: null }, defaultCapacity: 10, legacyCapacity: 20 })).toEqual({ capacity: 10, source: 'default' });
    expect(effectiveCapacity({ defaultCapacity: null, legacyCapacity: 20 })).toEqual({ capacity: 20, source: 'legacy' });
    expect(effectiveCapacity({})).toEqual({ capacity: null, source: 'unlimited' });
  });

  it('treats zero as a real capacity', () => {
    expect(effectiveCapacity({ override: { capacity: 0 }, defaultCapacity: 10 })).toEqual({ capacity: 0, source: 'override' });
  });
});

describe('computeDay', () => {
  it('counts sold and held together and never goes negative', () => {
    const d = day({ date: '2030-01-12', defaultCapacity: 10, sold: 6, held: 3 });
    expect(d).toMatchObject({ capacity: 10, sold: 6, held: 3, available: 1, status: 'low' });
    expect(day({ date: '2030-01-12', defaultCapacity: 5, sold: 4, held: 4 }).available).toBe(0);
  });

  it('classifies unlimited, ok, low (threshold inclusive), sold out', () => {
    expect(day({ date: '2030-01-12' }).status).toBe('unlimited');
    expect(day({ date: '2030-01-12', defaultCapacity: 100, sold: 10 }).status).toBe('ok');
    expect(day({ date: '2030-01-12', defaultCapacity: 20, sold: 10 }).status).toBe('low'); // 10 left = threshold
    expect(day({ date: '2030-01-12', defaultCapacity: 20, sold: 10, lowStockThreshold: 5 }).status).toBe('ok');
    expect(day({ date: '2030-01-12', defaultCapacity: 20, sold: 20 }).status).toBe('sold_out');
  });

  it('closed dates and stop-sale win over capacity; past and non-operational days are reported as such', () => {
    expect(day({ date: '2030-01-12', defaultCapacity: 10, override: { capacity: null, closed: true, note: 'x' } }).status).toBe('closed');
    expect(day({ date: '2030-01-12', defaultCapacity: 10, stopSale: true }).status).toBe('closed');
    expect(day({ date: '2030-01-09', defaultCapacity: 10 }).status).toBe('past');
    expect(day({ date: '2030-01-12', defaultCapacity: 10, operational: false }).status).toBe('non_operational');
  });

  it('uses the legacy option capacity when there is no policy', () => {
    expect(day({ date: '2030-01-12', legacyCapacity: 4, sold: 4 })).toMatchObject({ capacitySource: 'legacy', status: 'sold_out' });
  });
});

describe('summarizeWindow and summarizeHorizon', () => {
  const days = (): DayFigures[] => [
    day({ date: '2030-01-10', defaultCapacity: 10, sold: 10 }),
    day({ date: '2030-01-11', defaultCapacity: 10, sold: 7 }),
    day({ date: '2030-01-12', defaultCapacity: 100, sold: 1 }),
    day({ date: '2030-01-13', defaultCapacity: 10, operational: false }),
  ];

  it('totals the operational days and reports the worst status', () => {
    const w = summarizeWindow(days(), { defaultCapacity: 10 });
    expect(w).toMatchObject({ capacityTotal: 120, soldTotal: 18, availableTotal: 102, lowestRemaining: 0, nextSoldOutDate: '2030-01-10', status: 'low' });
  });

  it('is sold out only when every open day is sold out, and closed when nothing is open', () => {
    const soldOut = [day({ date: '2030-01-10', defaultCapacity: 2, sold: 2 }), day({ date: '2030-01-11', defaultCapacity: 2, sold: 2 })];
    expect(summarizeWindow(soldOut, {}).status).toBe('sold_out');
    expect(summarizeWindow(soldOut, { stopSale: true }).status).toBe('closed');
    const closed = [day({ date: '2030-01-10', defaultCapacity: 2, override: { capacity: null, closed: true, note: '' } })];
    expect(summarizeWindow(closed, {}).status).toBe('closed');
  });

  it('is unlimited without any finite capacity and ok with plenty left', () => {
    expect(summarizeWindow([day({ date: '2030-01-10' })], {})).toMatchObject({ status: 'unlimited', capacityTotal: null, availableTotal: null });
    expect(summarizeWindow([day({ date: '2030-01-10', defaultCapacity: 50 })], {}).status).toBe('ok');
    expect(summarizeWindow([], { defaultCapacity: 5 }).status).toBe('ok');
    expect(summarizeWindow([], {}).status).toBe('unlimited');
  });

  it('horizon: exhausted when it runs on some day but none can be booked; finds the next bookable date', () => {
    const all = [day({ date: '2030-01-10', defaultCapacity: 1, sold: 1 }), day({ date: '2030-01-11', defaultCapacity: 5, sold: 3 })];
    expect(summarizeHorizon(all, '2030-01-10')).toMatchObject({ exhausted: false, nextAvailableDate: '2030-01-11', lowStock: true, lowestRemaining: 2 });
    expect(summarizeHorizon([all[0]], '2030-01-10')).toMatchObject({ exhausted: true, nextAvailableDate: null });
    expect(summarizeHorizon([day({ date: '2030-01-10', operational: false })], '2030-01-10')).toMatchObject({ hasOperationalDay: false, exhausted: false });
  });

  it('a product is sold out only when every variant is exhausted', () => {
    const gone = summarizeHorizon([day({ date: '2030-01-10', defaultCapacity: 1, sold: 1 })], '2030-01-10');
    const open = summarizeHorizon([day({ date: '2030-01-10' })], '2030-01-10');
    expect(combineVariants([gone, gone]).soldOut).toBe(true);
    expect(combineVariants([gone, open]).soldOut).toBe(false);
    expect(combineVariants([]).soldOut).toBe(false);
    expect(publicStock(undefined)).toEqual({ soldOut: false, lowStock: false, nextAvailableDate: null });
  });
});

describe('expandDates', () => {
  it('lists every date, or only the chosen weekdays (0 = Sunday)', () => {
    expect(expandDates('2030-01-10', '2030-01-12')).toEqual(['2030-01-10', '2030-01-11', '2030-01-12']);
    // 2030-01-12 is a Saturday (6), 2030-01-13 a Sunday (0).
    expect(expandDates('2030-01-10', '2030-01-20', [6, 0])).toEqual(['2030-01-12', '2030-01-13', '2030-01-19', '2030-01-20']);
  });

  it('rejects bad ranges with a stable code', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    expect(code(() => expandDates('2030-02-30', '2030-03-01'))).toBe('INVALID_DATE');
    expect(code(() => expandDates('2030-01-12', '2030-01-10'))).toBe('INVALID_RANGE');
    expect(code(() => expandDates('2030-01-01', '2030-06-01'))).toBe('RANGE_TOO_LARGE');
    expect(expandDates('2030-01-01', '2030-04-03')).toHaveLength(93);
    expect(code(() => expandDates('2030-01-10', '2030-01-11', [3]))).toBe('NO_MATCHING_DAYS');
  });
});

describe('applyCapacityEdit', () => {
  it('sets, adds and removes (never below zero); add/remove on unlimited stays unlimited', () => {
    expect(applyCapacityEdit('set', 10, 4)).toBe(4);
    expect(applyCapacityEdit('add', 10, 4)).toBe(14);
    expect(applyCapacityEdit('remove', 10, 4)).toBe(6);
    expect(applyCapacityEdit('remove', 3, 4)).toBe(0);
    expect(applyCapacityEdit('add', null, 4)).toBeNull();
  });
});

describe('restockDecision', () => {
  const input = { serviceDay: '2030-01-20', startTime: '10:00' };
  // Service start is 2030-01-20 10:00 Dubai = 06:00 UTC.
  it('returns units when cancelled before the cutoff (default 24 hours) and keeps them after', () => {
    expect(restockDecision({ ...input, now: new Date('2030-01-19T05:59:00Z') }).restock).toBe(true);
    expect(restockDecision({ ...input, now: new Date('2030-01-19T06:00:00Z') }).restock).toBe(true); // exactly at the cutoff
    expect(restockDecision({ ...input, now: new Date('2030-01-19T06:01:00Z') }).restock).toBe(false);
  });

  it('honours the option cutoff, including 0 hours, and uses the start of the day without a start time', () => {
    expect(restockDecision({ ...input, cutoffHours: 2, now: new Date('2030-01-20T03:59:00Z') }).restock).toBe(true);
    expect(restockDecision({ ...input, cutoffHours: 2, now: new Date('2030-01-20T04:01:00Z') }).restock).toBe(false);
    expect(restockDecision({ ...input, cutoffHours: 0, now: new Date('2030-01-20T05:59:00Z') }).restock).toBe(true);
    const noTime = restockDecision({ serviceDay: '2030-01-20', cutoffHours: 24, now: new Date('2030-01-18T20:00:00Z') });
    expect(noTime.cutoffAt.toISOString()).toBe('2030-01-18T20:00:00.000Z'); // 00:00 Dubai minus 24h
    expect(noTime.restock).toBe(true);
  });
});

describe('alert de-duplication', () => {
  const today = '2030-01-10';
  const candidates = (...c: [string, 'low' | 'sold_out'][]) => c.map(([date, state]) => ({ date, state }));

  it('alerts a new state once and not again while it persists', () => {
    const first = diffAlerts(new Set(), candidates(['2030-01-12', 'low']), today);
    expect(first.create).toEqual(candidates(['2030-01-12', 'low']));
    const again = diffAlerts(new Set([alertKey('2030-01-12', 'low')]), candidates(['2030-01-12', 'low']), today);
    expect(again).toEqual({ create: [], remove: [] });
  });

  it('forgets a recovered state so a relapse alerts again, and drops passed days', () => {
    const recovered = diffAlerts(new Set([alertKey('2030-01-12', 'low')]), [], today);
    expect(recovered.remove).toEqual([alertKey('2030-01-12', 'low')]);
    const passed = diffAlerts(new Set([alertKey('2030-01-09', 'low')]), candidates(['2030-01-09', 'low']), today);
    expect(passed.remove).toEqual([alertKey('2030-01-09', 'low')]);
  });

  it('low -> sold out alerts sold out and keeps the low record (no repeat low alert when it sells back)', () => {
    const step = diffAlerts(new Set([alertKey('2030-01-12', 'low')]), candidates(['2030-01-12', 'sold_out']), today);
    expect(step.create).toEqual(candidates(['2030-01-12', 'sold_out']));
    expect(step.remove).toEqual([]);
    const back = diffAlerts(new Set([alertKey('2030-01-12', 'low'), alertKey('2030-01-12', 'sold_out')]), candidates(['2030-01-12', 'low']), today);
    expect(back).toEqual({ create: [], remove: [alertKey('2030-01-12', 'sold_out')] });
  });

  it('picks only low and sold out days as candidates', () => {
    const list = [day({ date: '2030-01-10', defaultCapacity: 100 }), day({ date: '2030-01-11', defaultCapacity: 5 }), day({ date: '2030-01-12', defaultCapacity: 1, sold: 1 })];
    expect(alertCandidates(list)).toEqual(candidates(['2030-01-11', 'low'], ['2030-01-12', 'sold_out']));
  });
});

describe('bookingStockView', () => {
  const now = new Date('2030-01-10T00:00:00Z');
  it('describes held, used, returned and returnable units', () => {
    expect(bookingStockView({ status: 'pending_payment', quantity: 2, holdExpiresAt: new Date('2030-01-10T00:10:00Z') }, now)).toMatchObject({ held: 2, used: 0, state: 'held', returnable: false });
    expect(bookingStockView({ status: 'confirmed', quantity: 2 }, now)).toMatchObject({ used: 2, state: 'used' });
    expect(bookingStockView({ status: 'cancelled', quantity: 2, stockReleased: false }, now)).toMatchObject({ used: 2, returnable: true });
    expect(bookingStockView({ status: 'cancelled', quantity: 2, stockReleased: true }, now)).toMatchObject({ returned: 2, released: true, returnable: false });
    expect(bookingStockView({ status: 'cancelled', quantity: 2 }, now)).toMatchObject({ used: 0, returned: 0, state: 'none' });
  });
});

describe('item ids and operating days', () => {
  it('round-trips item ids, including variants with colons and encoded input', () => {
    const key = { productType: 'cruise' as const, productRef: 'med-cruise', variantId: 'Balcony: Deluxe' };
    expect(parseItemId(formatItemId(key))).toEqual(key);
    expect(parseItemId(encodeURIComponent(formatItemId(key)))).toEqual(key);
    expect(parseItemId('bogus:x:y')).toBeNull();
    expect(parseItemId('activity:only-two')).toBeNull();
  });

  it('maps an instant to the Dubai calendar day', () => {
    expect(operatingDayOf(new Date('2030-01-10T21:00:00Z'))).toBe('2030-01-11');
  });
});
