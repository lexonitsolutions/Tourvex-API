import {
  buildCruiseFilter,
  buildCruiseSort,
  CRUISE_REFERENCE_PATTERN,
  derivePorts,
  derivePrice,
  generateCruiseReference,
  isUpcomingDeparture,
  monthBounds,
  MONTH_PATTERN,
  normalizeDepartureDates,
  publicVisibilityFilter,
  resolveDurationDays,
  shouldExposeSamples,
  startOfTodayUtc,
  upcomingDepartures,
  validateItinerary,
} from './cruises.utils';

const now = new Date('2026-10-04T15:30:00Z');

describe('upcomingDepartures', () => {
  it('keeps today (boundary) and the future, drops yesterday', () => {
    const result = upcomingDepartures(
      [
        new Date('2026-10-03T23:59:59.999Z'),
        new Date('2026-10-04T00:00:00.000Z'),
        new Date('2026-10-05T00:00:00.000Z'),
      ],
      now,
    );
    expect(result).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('sorts ascending, de-duplicates days, ignores invalid values and honours the limit', () => {
    const input = ['2026-12-01', '2026-11-01', '2026-11-01', 'garbage', '2026-11-20', '2027-01-01'];
    expect(upcomingDepartures(input, now)).toEqual(['2026-11-01', '2026-11-20', '2026-12-01', '2027-01-01']);
    expect(upcomingDepartures(input, now, 2)).toEqual(['2026-11-01', '2026-11-20']);
    expect(upcomingDepartures(undefined, now)).toEqual([]);
  });

  it('computes the start of today in UTC', () => {
    expect(startOfTodayUtc(now).toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });
});

describe('isUpcomingDeparture', () => {
  const departures = [new Date('2026-10-01T00:00:00Z'), new Date('2026-11-14T00:00:00Z')];

  it('accepts only the cruise upcoming departure days', () => {
    expect(isUpcomingDeparture('2026-11-14', departures, now)).toBe(true);
    expect(isUpcomingDeparture('2026-11-14T08:00:00Z', departures, now)).toBe(true);
    expect(isUpcomingDeparture('2026-11-15', departures, now)).toBe(false);
    expect(isUpcomingDeparture('2026-10-01', departures, now)).toBe(false); // past
    expect(isUpcomingDeparture('nope', departures, now)).toBe(false);
    expect(isUpcomingDeparture('2026-11-14', [], now)).toBe(false);
  });
});

describe('normalizeDepartureDates', () => {
  it('stores unique ascending UTC midnights', () => {
    const result = normalizeDepartureDates(['2026-12-02T18:00:00Z', '2026-11-01', '2026-11-01']);
    expect(result.map((d) => d.toISOString())).toEqual([
      '2026-11-01T00:00:00.000Z',
      '2026-12-02T00:00:00.000Z',
    ]);
  });
});

describe('monthBounds / month filter', () => {
  it('returns [start, end) UTC bounds, including the year rollover', () => {
    expect(monthBounds('2026-11')).toEqual({
      start: new Date('2026-11-01T00:00:00Z'),
      end: new Date('2026-12-01T00:00:00Z'),
    });
    expect(monthBounds('2026-12')?.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects malformed months', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026/11', '2026-11-01', '']) {
      expect(MONTH_PATTERN.test(bad)).toBe(false);
      expect(monthBounds(bad)).toBeNull();
    }
  });

  it('clamps the lower bound to today for public queries only', () => {
    const publicFilter = buildCruiseFilter({ month: '2026-10' }, {}, now, true);
    expect(publicFilter.departures).toEqual({
      $elemMatch: { $gte: startOfTodayUtc(now), $lt: new Date('2026-11-01T00:00:00Z') },
    });
    const adminFilter = buildCruiseFilter({ month: '2026-10' }, {}, now, false);
    expect(adminFilter.departures).toEqual({
      $elemMatch: { $gte: new Date('2026-10-01T00:00:00Z'), $lt: new Date('2026-11-01T00:00:00Z') },
    });
  });
});

describe('derivePrice', () => {
  it('uses the lowest cabin fare', () => {
    const price = derivePrice({
      cabins: [
        { fromPrice: { amount: 2400, currency: 'AED' } },
        { fromPrice: { amount: 1800, currency: 'AED' } },
        { fromPrice: null },
      ],
      price: { amount: 999, currency: 'AED' },
    });
    expect(price).toEqual({ amount: 1800, currency: 'AED' });
  });

  it('falls back to the stored price, then null', () => {
    expect(derivePrice({ cabins: [{ fromPrice: null }], price: { amount: 999, currency: 'AED' } })).toEqual({
      amount: 999,
      currency: 'AED',
    });
    expect(derivePrice({ cabins: [] })).toBeNull();
    expect(derivePrice({})).toBeNull();
  });
});

describe('derivePorts', () => {
  it('names sea days "At Sea", keeps the first six and counts all stops', () => {
    const itinerary = [
      { port: 'Dubai', type: 'embark' },
      { port: 'Open water', type: 'sea' },
      { port: 'Muscat', type: 'port' },
      { port: 'Khasab', type: 'port' },
      { port: 'Open water', type: 'sea' },
      { port: 'Fujairah', type: 'port' },
      { port: 'Dubai', type: 'disembark' },
    ];
    expect(derivePorts(itinerary)).toEqual({
      ports: ['Dubai', 'At Sea', 'Muscat', 'Khasab', 'At Sea', 'Fujairah'],
      portCount: 7,
    });
    expect(derivePorts(undefined)).toEqual({ ports: [], portCount: 0 });
  });
});

describe('itinerary validation', () => {
  it('defaults durationDays to nights + 1', () => {
    expect(resolveDurationDays(7)).toBe(8);
    expect(resolveDurationDays(7, 9)).toBe(9);
  });

  it('accepts consecutive days that match durationDays', () => {
    expect(validateItinerary([{ day: 1 }, { day: 2 }, { day: 3 }], 3)).toBeNull();
  });

  it('rejects a wrong length, gaps, duplicates and a start other than 1', () => {
    expect(validateItinerary([{ day: 1 }, { day: 2 }], 3)).toMatch(/exactly 3 days/);
    expect(validateItinerary([{ day: 1 }, { day: 3 }, { day: 4 }], 3)).toMatch(/consecutive/);
    expect(validateItinerary([{ day: 1 }, { day: 1 }, { day: 2 }], 3)).toMatch(/consecutive/);
    expect(validateItinerary([{ day: 2 }, { day: 3 }, { day: 4 }], 3)).toMatch(/starting at 1/);
  });
});

describe('sample visibility', () => {
  it('hides samples in production unless CRUISES_ALLOW_SAMPLES=true', () => {
    expect(shouldExposeSamples('development', undefined)).toBe(true);
    expect(shouldExposeSamples('production', undefined)).toBe(false);
    expect(shouldExposeSamples('production', 'false')).toBe(false);
    expect(shouldExposeSamples('production', 'true')).toBe(true);
    expect(publicVisibilityFilter(false)).toEqual({ published: true, isSample: { $ne: true } });
  });
});

describe('buildCruiseFilter', () => {
  const base = { published: true };

  it('requires an upcoming departure and nothing else for an empty query', () => {
    expect(buildCruiseFilter({}, base, now)).toEqual({
      published: true,
      departures: { $gte: startOfTodayUtc(now) },
    });
    expect(buildCruiseFilter({ q: '  ' }, base, now, false)).toEqual(base);
  });

  it('maps equality, nights range and escaped, diacritic-insensitive text search', () => {
    const filter = buildCruiseFilter(
      { q: 'türkiye (', city: 'Istanbul', line: 'X', region: 'Mediterranean', minNights: 4, maxNights: 8 },
      base,
      now,
    );
    expect(filter).toMatchObject({
      departureCity: 'Istanbul',
      cruiseLine: 'X',
      region: 'Mediterranean',
      durationNights: { $gte: 4, $lte: 8 },
    });
    const or = filter.$or as Record<string, RegExp>[];
    expect(or).toHaveLength(4);
    expect(or[0].title.test('Turkiye (Highlights')).toBe(true);
    expect(or[3]['itinerary.port']).toBeInstanceOf(RegExp);
  });
});

describe('buildCruiseSort', () => {
  it('defaults to popularity', () => {
    expect(buildCruiseSort().sort).toEqual({ popularity: -1, title: 1, _id: 1 });
  });

  it('sorts by derived price with unpriced cruises last in both directions', () => {
    const asc = buildCruiseSort('price_asc');
    expect(asc.sort._sortPrice).toBe(1);
    expect(JSON.stringify(asc.addFields)).toContain('cabins.fromPrice.amount');
    expect(JSON.stringify(asc.addFields)).toContain(String(Number.MAX_SAFE_INTEGER));
    expect(buildCruiseSort('price_desc').sort._sortPrice).toBe(-1);
  });

  it('sorts soonest by the earliest upcoming departure', () => {
    const soonest = buildCruiseSort('soonest', now);
    expect(Object.keys(soonest.sort)[0]).toBe('_next');
    expect(JSON.stringify(soonest.addFields)).toContain('2026-10-04T00:00:00.000Z');
  });

  it('sorts by nights', () => {
    expect(buildCruiseSort('nights_asc').sort.durationNights).toBe(1);
    expect(buildCruiseSort('nights_desc').sort.durationNights).toBe(-1);
  });
});

describe('generateCruiseReference', () => {
  it('has the CQ- prefix and 8 base32 characters', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateCruiseReference()).toMatch(CRUISE_REFERENCE_PATTERN);
    }
  });

  it('does not repeat across a large sample', () => {
    expect(new Set(Array.from({ length: 5000 }, () => generateCruiseReference())).size).toBe(5000);
  });
});
