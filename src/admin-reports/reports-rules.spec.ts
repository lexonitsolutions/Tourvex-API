import {
  addDays,
  bucketDates,
  buildInsights,
  buildSummary,
  cacheKey,
  compare,
  compareRates,
  deltaPct,
  previousWindow,
  rate,
  resolveRange,
  shortName,
  TtlCache,
  zeroFill,
} from './reports-rules';

const NOW = new Date('2026-10-05T10:00:00Z'); // 14:00 in Dubai

describe('resolveRange', () => {
  it('30d ends today (Dubai) and includes it', () => {
    const r = resolveRange({ range: '30d' }, NOW);
    expect(r.to).toBe('2026-10-05');
    expect(r.from).toBe('2026-09-06');
    expect(r.days).toHaveLength(30);
  });

  it('uses the Dubai day, not the UTC day, around midnight', () => {
    const r = resolveRange({ range: '7d' }, new Date('2026-10-05T20:30:00Z')); // already 06 Oct in Dubai
    expect(r.to).toBe('2026-10-06');
  });

  it('ytd starts on 1 January', () => {
    const r = resolveRange({ range: 'ytd' }, NOW);
    expect(r.from).toBe('2026-01-01');
    expect(r.days).toHaveLength(278);
  });

  it('previous period is the equal-length window right before', () => {
    const r = resolveRange({ range: '7d' }, NOW);
    expect(r.previous.to).toBe(addDays(r.from, -1));
    expect(r.previous.days).toHaveLength(7);
    expect(r.previous.from).toBe('2026-09-22');
    expect(r.previous.end.getTime()).toBe(r.start.getTime());
  });

  it('custom range wins over preset, accepts ISO instants and caps at 366 days', () => {
    expect(resolveRange({ range: '7d', from: '2026-09-01', to: '2026-09-10' }, NOW).days).toHaveLength(10);
    expect(resolveRange({ from: '2026-09-30T20:00:00Z', to: '2026-10-02' }, NOW).from).toBe('2026-10-01');
    expect(() => resolveRange({ from: '2025-01-01', to: '2026-10-05' }, NOW)).toThrow();
    expect(resolveRange({ from: '2025-10-05', to: '2026-10-05' }, NOW).days).toHaveLength(366);
    expect(() => resolveRange({ from: '2026-10-05', to: '2026-10-01' }, NOW)).toThrow();
    expect(() => resolveRange({ range: '1y' }, NOW)).toThrow();
  });

  it('previousWindow handles a single day', () => {
    expect(previousWindow('2026-10-05', '2026-10-05').days).toEqual(['2026-10-04']);
  });
});

describe('buckets', () => {
  it('buckets instants into Dubai days and zero-fills quiet days', () => {
    const days = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
    const dates = [
      new Date('2026-10-05T19:59:59Z'), // 05 Oct 23:59 Dubai
      new Date('2026-10-05T20:00:00Z'), // 06 Oct 00:00 Dubai
      new Date('2026-10-05T21:00:00Z'),
    ];
    expect(bucketDates(days, dates)).toEqual([0, 1, 2, 0]);
  });

  it('zeroFill reads maps and records and ignores days outside the window', () => {
    expect(zeroFill(['a', 'b'], new Map([['a', 3], ['x', 9]]))).toEqual([3, 0]);
    expect(zeroFill(['a', 'b'], { b: 2 })).toEqual([0, 2]);
  });
});

describe('deltas', () => {
  it('percent change with one decimal; null when previous is 0', () => {
    expect(deltaPct(112, 100)).toBe(12);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(1, 3)).toBe(-66.7);
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBeNull();
  });

  it('compare names the state, using new for 0 -> something', () => {
    expect(compare(5, 0)).toMatchObject({ deltaPct: null, state: 'new' });
    expect(compare(0, 0)).toMatchObject({ deltaPct: null, state: 'none' });
    expect(compare(10, 10)).toMatchObject({ deltaPct: 0, state: 'flat' });
    expect(compare(0, 4)).toMatchObject({ deltaPct: -100, state: 'down' });
    expect(compare(6, 4)).toMatchObject({ deltaPct: 50, state: 'up' });
  });

  it('rates are null without a denominator and compare in percentage points', () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 3)).toBe(33.3);
    expect(compareRates(2, 10, 0, 0)).toMatchObject({ value: 20, previous: null, deltaPts: null, state: 'new' });
    expect(compareRates(3, 10, 1, 10)).toMatchObject({ value: 30, previous: 10, deltaPts: 20, state: 'up' });
    expect(compareRates(0, 0, 0, 0)).toMatchObject({ value: null, state: 'none' });
  });
});

describe('shortName', () => {
  it('keeps first name and last initial only', () => {
    expect(shortName('Sandhani Sekar')).toBe('Sandhani S.');
    expect(shortName('  Ana  Maria  de la Cruz ')).toBe('Ana C.');
    expect(shortName('Madonna')).toBe('Madonna');
    expect(shortName('')).toBe('Guest');
    expect(shortName(undefined)).toBe('Guest');
  });
});

describe('insights', () => {
  const base = { rangeLabel: '30 days' };

  it('describes revenue movement and links to the sales report', () => {
    const [i] = buildInsights({ ...base, revenue: { value: 11200, previous: 10000 } });
    expect(i).toMatchObject({ id: 'revenue', severity: 'info', href: '/admin/reports/sales' });
    expect(i.text).toBe('Revenue is AED 11,200, up 12% on the previous 30 days');
  });

  it('says new / steady / none instead of inventing percentages', () => {
    expect(buildInsights({ ...base, revenue: { value: 500, previous: 0 } })[0].text).toContain('new against the previous 30 days');
    expect(buildInsights({ ...base, revenue: { value: 1010, previous: 1000 } })[0].text).toContain('steady');
    expect(buildInsights({ ...base, revenue: { value: 0, previous: 0 } })[0].text).toBe('No confirmed revenue in these 30 days');
    expect(buildInsights({ ...base, revenue: { value: 0, previous: 800 } })[0].text).toContain('down from AED 800');
  });

  it('falls back to bookings when revenue is not visible', () => {
    const out = buildInsights({ ...base, bookings: { value: 8, previous: 4, pendingCancellationRequests: 0 } });
    expect(out[0].id).toBe('bookings');
    expect(out[0].text).toContain('8 bookings created, up 100%');
  });

  it('warns for work that needs a person, with the right links, and pluralises', () => {
    const out = buildInsights({
      ...base,
      bookings: { value: 1, previous: 1, pendingCancellationRequests: 3 },
      tickets: { overdue: 1 },
      leads: { overdueFollowUps: 2, unassignedOpen: 0 },
      excludedNonAed: 1,
    });
    const byId = Object.fromEntries(out.map((i) => [i.id, i]));
    expect(byId['cancellation-requests']).toMatchObject({ severity: 'warn', text: '3 cancellation requests waiting for a decision', href: '/admin/bookings/cancellations' });
    expect(byId['tickets-overdue'].text).toBe('1 ticket past its SLA target');
    expect(byId['leads-overdue'].text).toBe('2 lead follow-ups overdue');
    expect(byId['leads-unassigned']).toBeUndefined();
    expect(byId['non-aed'].severity).toBe('info');
  });

  it('flags a low SLA only with a meaningful sample', () => {
    expect(buildInsights({ ...base, tickets: { overdue: 0, sla: { compliance: 50, evaluated: 4, met: 2 } } })).toHaveLength(0);
    const out = buildInsights({ ...base, tickets: { overdue: 0, sla: { compliance: 61.5, evaluated: 13, met: 8 } } });
    expect(out[0]).toMatchObject({ id: 'sla-low', severity: 'warn' });
    expect(buildInsights({ ...base, tickets: { overdue: 0, sla: { compliance: 95, evaluated: 20, met: 19 } } })).toHaveLength(0);
  });

  it('never mentions what the caller cannot see', () => {
    expect(buildInsights(base)).toEqual([]);
    expect(buildSummary([]).headline).toMatch(/Not enough data/);
  });

  it('summary = headline sentence plus every warning', () => {
    const s = buildSummary(buildInsights({ ...base, revenue: { value: 10, previous: 20 }, tickets: { overdue: 2 } }));
    expect(s.headline).toContain('down 50%');
    expect(s.attention).toEqual([{ id: 'tickets-overdue', text: '2 tickets past their SLA target', href: '/admin/tickets?tab=overdue' }]);
  });
});

describe('cache', () => {
  it('expires after the ttl and keys on window + sorted permissions', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1, 0);
    expect(cache.get('a', 59_999)).toBe(1);
    expect(cache.get('a', 60_001)).toBeUndefined();
    expect(cacheKey({ from: '2026-09-01', to: '2026-09-30' }, ['finance.read', 'bookings.read'])).toBe(cacheKey({ from: '2026-09-01', to: '2026-09-30' }, ['bookings.read', 'finance.read']));
    expect(cacheKey({ from: 'a', to: 'b' }, ['x'])).not.toBe(cacheKey({ from: 'a', to: 'b' }, ['x', 'y']));
  });

  it('evicts when full', () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    cache.set('c', 3, 0);
    expect([cache.get('a', 1), cache.get('b', 1), cache.get('c', 1)].filter((v) => v !== undefined)).toHaveLength(2);
  });
});
