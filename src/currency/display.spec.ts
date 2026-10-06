import { indicativeDisplay } from './display';

const rates = { AED: 1, USD: 0.2723, JPY: 41.5 };

describe('indicativeDisplay', () => {
  it('converts an AED total for a supported currency', () => {
    expect(indicativeDisplay(383.25, 'usd', rates, 0)).toEqual({
      currency: 'USD',
      total: { amount: 104.36, currency: 'USD' },
    });
    expect(indicativeDisplay(100, 'JPY', rates, 0)?.total.amount).toBe(4150);
  });

  it('applies the configured markup', () => {
    expect(indicativeDisplay(100, 'USD', rates, 10)?.total.amount).toBe(29.95);
  });

  it('is undefined for AED, unsupported codes, missing input and missing rates', () => {
    expect(indicativeDisplay(100, 'AED', rates, 0)).toBeUndefined();
    expect(indicativeDisplay(100, 'XYZ', rates, 0)).toBeUndefined();
    expect(indicativeDisplay(100, undefined, rates, 0)).toBeUndefined();
    expect(indicativeDisplay(100, 'EUR', rates, 0)).toBeUndefined();
    expect(indicativeDisplay(100, 'USD', { AED: 1 }, 0)).toBeUndefined();
  });
});
