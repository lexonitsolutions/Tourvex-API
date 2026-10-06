import { generateSessions, SAMPLE_BANNERS, SAMPLE_EVENTS } from '../../scripts/data/events-sample';
import {
  buildEventFilter,
  buildEventSort,
  dayBounds,
  derivePrice,
  EVENT_CATEGORIES,
  EVENT_REFERENCE_PATTERN,
  generateEventReference,
  isUpcomingSessionId,
  normalizeSessions,
  publicVisibilityFilter,
  resolveCategory,
  shouldExposeSamples,
  startOfTodayUtc,
  upcomingSessions,
  validateSessions,
} from './events.utils';

const now = new Date('2026-10-04T15:30:00Z');

describe('upcomingSessions', () => {
  it('keeps today (boundary) and the future, drops yesterday, sorts ascending', () => {
    const result = upcomingSessions(
      [
        { startsAt: new Date('2026-10-06T19:00:00Z') },
        { startsAt: new Date('2026-10-03T23:59:59.999Z') },
        { startsAt: new Date('2026-10-04T00:00:00.000Z') },
        { startsAt: 'garbage' },
      ],
      now,
    );
    expect(result.map((s) => new Date(s.startsAt as Date).toISOString())).toEqual([
      '2026-10-04T00:00:00.000Z',
      '2026-10-06T19:00:00.000Z',
    ]);
  });

  it('honours the limit and tolerates missing input', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      startsAt: new Date(Date.UTC(2026, 10, 1 + i)),
    }));
    expect(upcomingSessions(many, now, 2)).toHaveLength(2);
    expect(upcomingSessions(undefined, now)).toEqual([]);
  });
});

describe('isUpcomingSessionId', () => {
  const sessions = [
    { _id: 'aaa', startsAt: new Date('2026-10-01T19:00:00Z') },
    { _id: 'bbb', startsAt: new Date('2026-11-01T19:00:00Z') },
  ];
  it('accepts only ids of upcoming sessions', () => {
    expect(isUpcomingSessionId('bbb', sessions, now)).toBe(true);
    expect(isUpcomingSessionId('aaa', sessions, now)).toBe(false);
    expect(isUpcomingSessionId('ccc', sessions, now)).toBe(false);
  });
});

describe('normalizeSessions / validateSessions', () => {
  it('sorts, de-duplicates by start time and keeps door times', () => {
    const result = normalizeSessions([
      { startsAt: '2026-11-02T19:00:00Z', doorsOpenAt: '2026-11-02T18:00:00Z' },
      { startsAt: '2026-11-01T19:00:00Z' },
      { startsAt: '2026-11-01T19:00:00Z' },
    ]);
    expect(result.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-11-01T19:00:00.000Z',
      '2026-11-02T19:00:00.000Z',
    ]);
    expect(result[1].doorsOpenAt?.toISOString()).toBe('2026-11-02T18:00:00.000Z');
  });

  it('rejects doors opening after the start', () => {
    expect(
      validateSessions([{ startsAt: '2026-11-01T19:00:00Z', doorsOpenAt: '2026-11-01T20:00:00Z' }]),
    ).toMatch(/doorsOpenAt/);
    expect(
      validateSessions([{ startsAt: '2026-11-01T19:00:00Z', doorsOpenAt: '2026-11-01T18:00:00Z' }]),
    ).toBeNull();
  });
});

describe('category and day helpers', () => {
  it('resolves names and slugs case-insensitively', () => {
    expect(resolveCategory('concerts')).toBe('Concerts');
    expect(resolveCategory('FAMILY')).toBe('Family');
    expect(resolveCategory('nope')).toBeUndefined();
    expect(EVENT_CATEGORIES).toHaveLength(7);
  });

  it('computes UTC day bounds and rejects non-dates', () => {
    expect(dayBounds('2026-11-14')).toEqual({
      start: new Date('2026-11-14T00:00:00.000Z'),
      end: new Date('2026-11-15T00:00:00.000Z'),
    });
    expect(dayBounds('2026-02-30')).toBeNull();
    expect(dayBounds('14-11-2026')).toBeNull();
  });
});

describe('derivePrice', () => {
  it('uses the lowest ticket price, then the stored price, then null', () => {
    expect(
      derivePrice({
        ticketTypes: [
          { price: { amount: 300, currency: 'AED' } },
          { price: { amount: 95, currency: 'AED' } },
          { price: null },
        ],
        price: { amount: 1, currency: 'AED' },
      }),
    ).toEqual({ amount: 95, currency: 'AED' });
    expect(derivePrice({ ticketTypes: [], price: { amount: 120, currency: 'AED' } })).toEqual({
      amount: 120,
      currency: 'AED',
    });
    expect(derivePrice({})).toBeNull();
  });
});

describe('buildEventFilter', () => {
  const base = { published: true };
  const today = startOfTodayUtc(now);

  it('requires an upcoming session for public queries only', () => {
    expect(buildEventFilter({}, base, now).sessions).toEqual({
      $elemMatch: { startsAt: { $gte: today } },
    });
    expect(buildEventFilter({}, {}, now, false)).toEqual({});
  });

  it('searches title, venue, city and tags with an escaped, diacritic-insensitive pattern', () => {
    const filter = buildEventFilter({ q: 'Harbour (' }, base, now);
    const clauses = filter.$or as Record<string, RegExp>[];
    expect(clauses.map((c) => Object.keys(c)[0])).toEqual(['title', 'venue', 'city', 'tags']);
    expect(clauses[0].title.test('Harbour (Arena')).toBe(true);
  });

  it('applies city and category (name or slug); unknown categories stay as given', () => {
    expect(buildEventFilter({ city: 'Dubai', category: 'concerts' }, base, now)).toMatchObject({
      city: 'Dubai',
      category: 'Concerts',
    });
    expect(buildEventFilter({ category: 'zzz' }, base, now).category).toBe('zzz');
  });

  it('narrows to a single day, never before today', () => {
    expect(buildEventFilter({ date: '2026-11-14' }, base, now).sessions).toEqual({
      $elemMatch: {
        startsAt: {
          $gte: new Date('2026-11-14T00:00:00.000Z'),
          $lt: new Date('2026-11-15T00:00:00.000Z'),
        },
      },
    });
    expect(buildEventFilter({ date: '2026-09-01' }, base, now).sessions).toEqual({
      $elemMatch: { startsAt: { $gte: today, $lt: new Date('2026-09-02T00:00:00.000Z') } },
    });
  });

  it('treats from/to as an inclusive day range', () => {
    expect(buildEventFilter({ from: '2026-11-01', to: '2026-11-30' }, base, now).sessions).toEqual({
      $elemMatch: {
        startsAt: {
          $gte: new Date('2026-11-01T00:00:00.000Z'),
          $lt: new Date('2026-12-01T00:00:00.000Z'),
        },
      },
    });
  });
});

describe('buildEventSort', () => {
  it('defaults to soonest and sorts unpriced/session-less events last', () => {
    const soonest = buildEventSort(undefined, now);
    expect(soonest.sort).toEqual({ _next: 1, popularity: -1, _id: 1 });
    expect(soonest.addFields).toHaveProperty('_next');
    expect(buildEventSort('popular').sort).toEqual({ popularity: -1, title: 1, _id: 1 });
    expect(buildEventSort('price_asc').sort._sortPrice).toBe(1);
    expect(buildEventSort('price_desc').sort._sortPrice).toBe(-1);
  });
});

describe('references and sample visibility', () => {
  it('generates EQ- references of 8 base32 characters', () => {
    for (let i = 0; i < 50; i += 1)
      expect(generateEventReference()).toMatch(EVENT_REFERENCE_PATTERN);
  });

  it('hides samples in production unless explicitly allowed', () => {
    expect(shouldExposeSamples('production', undefined)).toBe(false);
    expect(shouldExposeSamples('production', 'true')).toBe(true);
    expect(shouldExposeSamples('development', undefined)).toBe(true);
    expect(publicVisibilityFilter(false)).toEqual({ published: true, isSample: { $ne: true } });
  });
});

describe('sample data', () => {
  const today = startOfTodayUtc(new Date()).getTime();

  it('generates only future evening sessions within about four months', () => {
    for (const plan of ['weekly', 'biweekly', 'run', 'pair'] as const) {
      for (let index = 0; index < 24; index += 1) {
        const sessions = generateSessions(index, plan);
        expect(sessions.length).toBeGreaterThan(0);
        for (const s of sessions) {
          const t = new Date(s.startsAt);
          expect(t.getTime()).toBeGreaterThan(Date.now());
          expect(t.getTime() - today).toBeLessThanOrEqual(121 * 86_400_000);
          const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
          expect(minutes).toBeGreaterThanOrEqual(18 * 60);
          expect(minutes).toBeLessThanOrEqual(21 * 60 + 30);
          expect(new Date(s.doorsOpenAt).getTime()).toBeLessThan(t.getTime());
        }
      }
    }
  });

  it('has 24 fictional events across the seven categories with 2-4 priced ticket types', () => {
    expect(SAMPLE_EVENTS).toHaveLength(24);
    expect(new Set(SAMPLE_EVENTS.map((e) => e.category))).toEqual(new Set(EVENT_CATEGORIES));
    expect(new Set(SAMPLE_EVENTS.map((e) => e.slug)).size).toBe(24);
    for (const event of SAMPLE_EVENTS) {
      expect(event.ticketTypes.length).toBeGreaterThanOrEqual(2);
      expect(event.ticketTypes.length).toBeLessThanOrEqual(4);
      for (const ticket of event.ticketTypes) {
        expect(ticket.price.amount).toBeGreaterThanOrEqual(95);
        expect(ticket.price.amount).toBeLessThanOrEqual(950);
      }
      expect(event.coverImage).toMatch(/^\/images\/[\w-]+\.jpg$/);
      for (const img of event.images) expect(img.url).toMatch(/^\/images\/[\w-]+\.jpg$/);
    }
  });

  it('links the three banners to the agreed routes', () => {
    expect(SAMPLE_BANNERS.map((b) => b.ctaHref)).toEqual([
      '/events/in/Dubai',
      '/events/category/concerts',
      '/events/category/family',
    ]);
  });
});
