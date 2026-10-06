import {
  convertAmount,
  convertPayload,
  convertResponseBody,
  isConvertibleRoute,
  isMoney,
  isStale,
  normalizeCurrency,
} from './currency.conversion';

const rates = { AED: 1, USD: 0.2723, EUR: 0.2321, JPY: 41.5, KWD: 0.0836 };
const ctx = (target: string, markupPercent = 0) => ({ target, rates, markupPercent });

describe('normalizeCurrency', () => {
  it('upper-cases supported codes and ignores unknown or malformed ones', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' eur ')).toBe('EUR');
    expect(normalizeCurrency('XYZ')).toBeNull();
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
    expect(normalizeCurrency(['USD'])).toBeNull();
  });
});

describe('isConvertibleRoute', () => {
  const ok = (path: string, method = 'GET') => isConvertibleRoute(method, path, 'api/v1');

  it('allows public read routes of priced modules', () => {
    for (const p of [
      '/api/v1/holidays',
      '/api/v1/holidays/home',
      '/api/v1/holidays/dubai-stopover?currency=USD',
      '/api/v1/visas/home',
      '/api/v1/cruises/home',
      '/api/v1/events/home',
      '/api/v1/events',
      '/api/v1/events/skyline-night-live?currency=USD',
      '/api/v1/catalog/activities',
      '/api/v1/catalog/activities/some-slug',
      '/api/v1/catalog/activities/some-slug/availability?optionId=a&month=2026-10&currency=USD',
      '/api/v1/catalog/activities/some-slug/reviews',
      '/api/v1/platform/settings',
    ]) {
      expect(ok(p)).toBe(true);
    }
  });

  it('never converts non-GET requests', () => {
    expect(ok('/api/v1/holidays', 'POST')).toBe(false);
    expect(ok('/api/v1/holidays/x', 'PATCH')).toBe(false);
  });

  it('excludes bookings, payments, crm, admin and enquiry routes', () => {
    for (const p of [
      '/api/v1/bookings',
      '/api/v1/bookings/123',
      '/api/v1/bookings/order/OR-ABCD2345',
      '/api/v1/checkout/cart',
      '/api/v1/checkout/cart/status?currency=USD',
      '/api/v1/checkout/sessions/665f1c2b9a1e4b0012345678',
      '/api/v1/checkout/promos',
      '/api/v1/catalog/activities/some-slug/checkout',
      '/api/v1/payments/intent',
      '/api/v1/crm/invoices',
      '/api/v1/crm/inventory',
      '/api/v1/visas/admin/all',
      '/api/v1/holidays/admin/all',
      '/api/v1/visas/enquiries/admin',
      '/api/v1/events/enquiries/admin',
      '/api/v1/events/admin/all',
      '/api/v1/events/enquiries',
      '/api/v1/users/me',
      '/api/v1/currency/rates',
      '/api/v1/health',
    ]) {
      expect(ok(p)).toBe(false);
    }
  });
});

describe('convertAmount', () => {
  it('rounds to minor units: JPY 0 decimals, USD 2, KWD 3', () => {
    expect(convertAmount(100, 'AED', 'JPY', rates)).toBe(4150);
    expect(convertAmount(123.45, 'AED', 'JPY', rates)).toBe(5123);
    expect(convertAmount(100, 'AED', 'USD', rates)).toBe(27.23);
    expect(convertAmount(33.33, 'AED', 'USD', rates)).toBe(9.08);
    expect(convertAmount(100, 'AED', 'KWD', rates)).toBe(8.36);
  });

  it('cross-rates through AED', () => {
    // 100 USD -> AED 367.25 -> EUR
    expect(convertAmount(100, 'USD', 'EUR', rates)).toBe(85.24);
    expect(convertAmount(10, 'USD', 'AED', rates)).toBe(36.72);
  });

  it('applies markup to non-AED targets only', () => {
    expect(convertAmount(100, 'AED', 'USD', rates, 10)).toBe(29.95);
    expect(convertAmount(100, 'USD', 'AED', rates, 10)).toBe(367.24);
  });

  it('returns null when a rate is missing', () => {
    expect(convertAmount(100, 'AED', 'GBP', rates)).toBeNull();
    expect(convertAmount(100, 'XXX', 'USD', rates)).toBeNull();
  });
});

describe('isMoney', () => {
  it('requires numeric amount and string currency on a plain object', () => {
    expect(isMoney({ amount: 1, currency: 'AED' })).toBe(true);
    expect(isMoney({ amount: 1, currency: 'AED', note: 'x' })).toBe(true);
    expect(isMoney({ amount: '1', currency: 'AED' })).toBe(false);
    expect(isMoney({ amount: 1 })).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney([{ amount: 1, currency: 'AED' }])).toBe(false);
  });
});

describe('convertPayload', () => {
  it('leaves JSON without Money untouched (same reference)', () => {
    const body = { items: [{ id: 1, price: 120, title: 'x' }], total: 5, nested: { amount: 3 } };
    expect(convertPayload(body, ctx('USD'))).toBe(body);
  });

  it('converts nested Money inside objects and arrays, keeping extra keys', () => {
    const body = {
      items: [
        { id: 1, price: { amount: 100, currency: 'AED' }, salePrice: null },
        { id: 2, cabins: [{ fromPrice: { amount: 200, currency: 'AED', label: 'from' } }] },
      ],
      count: 100,
    };
    const out = convertPayload(body, ctx('USD'));
    expect(out.items[0].price).toEqual({ amount: 27.23, currency: 'USD' });
    expect(out.items[1].cabins?.[0].fromPrice).toEqual({ amount: 54.46, currency: 'USD', label: 'from' });
    expect(out.count).toBe(100);
    // input not mutated
    expect(body.items[0].price).toEqual({ amount: 100, currency: 'AED' });
  });

  it('does not touch bare numbers that sit next to a currency string', () => {
    const body = { amount: 'n/a', currency: 'AED', fee: 50 };
    expect(convertPayload(body, ctx('USD'))).toBe(body);
  });

  it('leaves Money with an unknown source currency untouched', () => {
    const body = { price: { amount: 10, currency: 'XXX' } };
    expect(convertPayload(body, ctx('USD'))).toBe(body);
  });

  it('does not double convert Money already in the target currency', () => {
    const body = { price: { amount: 10, currency: 'USD' } };
    expect(convertPayload(body, ctx('USD'))).toBe(body);
  });

  it('leaves non-plain objects such as Dates alone', () => {
    const date = new Date();
    const body = { at: date, price: { amount: 100, currency: 'AED' } };
    const out = convertPayload(body, ctx('JPY'));
    expect(out.at).toBe(date);
    expect(out.price).toEqual({ amount: 4150, currency: 'JPY' });
  });
});

describe('convertResponseBody', () => {
  const body = { items: [{ price: { amount: 100, currency: 'AED' } }], currency: 'USD' };

  it('converts and rewrites the top-level currency echo to the target', () => {
    const { body: out, active } = convertResponseBody(body, 'USD', rates, 0);
    expect(active).toBe(true);
    expect(out.currency).toBe('USD');
    expect(out.items[0].price).toEqual({ amount: 27.23, currency: 'USD' });
  });

  it('ignores an unknown target and resets a module echo to AED', () => {
    const { body: out, active } = convertResponseBody({ ...body, currency: 'XYZ' }, null, rates, 0);
    expect(active).toBe(false);
    expect(out.currency).toBe('AED');
    expect(out.items[0].price).toEqual({ amount: 100, currency: 'AED' });
  });

  it('is a no-op when no rates exist (AED only)', () => {
    const { body: out, active } = convertResponseBody(body, 'USD', { AED: 1 }, 0);
    expect(active).toBe(false);
    expect(out.currency).toBe('AED');
    expect(out.items[0].price).toEqual({ amount: 100, currency: 'AED' });
  });

  it('returns arrays and primitives unchanged', () => {
    const list = [1, 2];
    expect(convertResponseBody(list, 'USD', rates, 0).body).toBe(list);
    expect(convertResponseBody('text', 'USD', rates, 0).body).toBe('text');
  });

  it('does not treat a top-level Money as a currency echo', () => {
    const { body: out } = convertResponseBody({ amount: 100, currency: 'AED' }, 'JPY', rates, 0);
    expect(out).toEqual({ amount: 4150, currency: 'JPY' });
  });
});

describe('isStale', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  it('flags missing, old and fresh timestamps', () => {
    expect(isStale(null, now, 72)).toBe(true);
    expect(isStale(new Date('2026-10-01T00:00:00Z'), now, 72)).toBe(false);
    expect(isStale(new Date('2026-09-30T23:59:00Z'), now, 72)).toBe(true);
  });
});
