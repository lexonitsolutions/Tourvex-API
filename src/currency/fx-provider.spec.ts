import { ExchangeRateApiProvider, parseExchangeRatePayload, type FetchLike } from './fx-provider';

const good = () => ({
  result: 'success',
  base_code: 'AED',
  time_last_update_unix: 1_790_000_000,
  rates: { AED: 1, USD: 0.2723, EUR: 0.2321, ZZZ: 5 },
});

describe('parseExchangeRatePayload', () => {
  it('accepts a valid payload, keeping supported currencies only', () => {
    const snap = parseExchangeRatePayload(good());
    expect(snap.rates).toEqual({ AED: 1, EUR: 0.2321, USD: 0.2723 });
    expect(snap.providerUpdatedAt.toISOString()).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it.each([
    ['null payload', null],
    ['non-object', 'oops'],
    ['failed result', { ...good(), result: 'error' }],
    ['wrong base', { ...good(), base_code: 'USD' }],
    ['missing rates', { ...good(), rates: undefined }],
    ['array rates', { ...good(), rates: [1] }],
    ['AED not 1', { ...good(), rates: { AED: 2, USD: 1 } }],
    ['zero rate', { ...good(), rates: { AED: 1, USD: 0 } }],
    ['negative rate', { ...good(), rates: { AED: 1, USD: -1 } }],
    ['NaN rate', { ...good(), rates: { AED: 1, USD: Number.NaN } }],
    ['string rate', { ...good(), rates: { AED: 1, USD: '0.27' } }],
    ['bad rate in unsupported code', { ...good(), rates: { AED: 1, USD: 0.27, ZZZ: 0 } }],
    ['only AED', { ...good(), rates: { AED: 1 } }],
    ['missing update time', { ...good(), time_last_update_unix: undefined }],
  ])('rejects %s', (_name, payload) => {
    expect(() => parseExchangeRatePayload(payload)).toThrow();
  });
});

describe('ExchangeRateApiProvider', () => {
  const respond = (body: unknown, ok = true, status = 200): FetchLike =>
    jest.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) }));

  it('uses the injected fetcher and validates the response', async () => {
    const fetcher = respond(good());
    const provider = new ExchangeRateApiProvider('https://fx.test/latest/AED', undefined, fetcher);
    await expect(provider.fetchRates()).resolves.toMatchObject({ rates: { USD: 0.2723 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects HTTP errors and bad payloads', async () => {
    const http = new ExchangeRateApiProvider('https://fx.test', undefined, respond({}, false, 503));
    await expect(http.fetchRates()).rejects.toThrow('HTTP 503');
    const bad = new ExchangeRateApiProvider('https://fx.test', undefined, respond({ result: 'error' }));
    await expect(bad.fetchRates()).rejects.toThrow();
  });

  it('substitutes the API key into a {key} placeholder', async () => {
    const fetcher = respond(good());
    await new ExchangeRateApiProvider('https://fx.test/{key}/latest/AED', 'a b', fetcher).fetchRates();
    expect((fetcher as jest.Mock).mock.calls[0][0]).toBe('https://fx.test/a%20b/latest/AED');
  });

  it('aborts after the timeout', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    const provider = new ExchangeRateApiProvider('https://fx.test', undefined, hang, 10);
    await expect(provider.fetchRates()).rejects.toThrow('aborted');
  });
});
