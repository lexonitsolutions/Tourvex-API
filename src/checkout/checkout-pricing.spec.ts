import {
  allocate,
  generateOrderReference,
  holdExpiry,
  isHoldActive,
  priceCart,
  priceTravellers,
  promoDiscountMinor,
  promoRejection,
  taxMinor,
  toMinor,
  type PromoRules,
} from './checkout-pricing';

const aed = (amount: number) => ({ amount, currency: 'AED' });

describe('priceTravellers', () => {
  it('prices adults and children separately with readable lines', () => {
    const result = priceTravellers({ adultPrice: aed(135), childPrice: aed(95), adults: 2, children: 1 });
    expect(result.subtotalMinor).toBe(36_500);
    expect(result.lines).toEqual([
      { label: '2 adults x', unit: aed(135), qty: 2, total: aed(270) },
      { label: '1 child x', unit: aed(95), qty: 1, total: aed(95) },
    ]);
  });

  it('uses singular labels and skips the child line without children', () => {
    const result = priceTravellers({ adultPrice: aed(99.99), adults: 1, children: 0 });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].label).toBe('1 adult x');
    expect(result.subtotalMinor).toBe(9_999);
  });

  it('refuses to price children without a child price', () => {
    expect(() => priceTravellers({ adultPrice: aed(10), childPrice: null, adults: 1, children: 1 })).toThrow();
  });

  it('rounds decimal prices without float drift', () => {
    expect(toMinor(19.99)).toBe(1_999);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor(1.005)).toBe(101);
  });
});

describe('tax', () => {
  it('is a percent of the base, rounded to the nearest fils', () => {
    expect(taxMinor(36_500, 5)).toBe(1_825);
    expect(taxMinor(10_001, 5)).toBe(500);
    expect(taxMinor(100, 0)).toBe(0);
  });
});

describe('promoDiscountMinor', () => {
  const percent = (over: Partial<PromoRules> = {}): PromoRules => ({ type: 'percent', value: 10, ...over });

  it('computes a percent discount and applies the cap', () => {
    expect(promoDiscountMinor(percent(), 30_000)).toBe(3_000);
    expect(promoDiscountMinor(percent({ maxDiscount: 20 }), 30_000)).toBe(2_000);
  });

  it('computes a fixed discount, never above the eligible subtotal', () => {
    expect(promoDiscountMinor({ type: 'fixed', value: 50 }, 30_000)).toBe(5_000);
    expect(promoDiscountMinor({ type: 'fixed', value: 500 }, 30_000)).toBe(30_000);
    expect(promoDiscountMinor({ type: 'fixed', value: 50, maxDiscount: 30 }, 30_000)).toBe(3_000);
  });

  it('gives nothing below the minimum spend', () => {
    expect(promoDiscountMinor(percent({ minSubtotal: 400 }), 39_999)).toBe(0);
    expect(promoDiscountMinor(percent({ minSubtotal: 400 }), 40_000)).toBe(4_000);
  });

  it('gives nothing for an empty eligible subtotal', () => {
    expect(promoDiscountMinor(percent(), 0)).toBe(0);
  });
});

describe('promoRejection', () => {
  const now = new Date('2026-10-04T00:00:00.000Z');
  const promo = { published: true, usedCount: 0 };

  it('accepts a live code and explains each rejection', () => {
    expect(promoRejection(promo, now)).toBeNull();
    expect(promoRejection({ ...promo, published: false }, now)).toBe('unpublished');
    expect(promoRejection({ ...promo, validFrom: new Date('2026-11-01') }, now)).toBe('not_started');
    expect(promoRejection({ ...promo, validTo: new Date('2026-09-01') }, now)).toBe('expired');
    expect(promoRejection({ ...promo, usageLimit: 5, usedCount: 5 }, now)).toBe('exhausted');
    expect(promoRejection({ ...promo, usageLimit: 5, usedCount: 4 }, now)).toBeNull();
  });
});

describe('allocate', () => {
  it('splits a total so the parts always add up (largest remainder)', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocate(7, [0, 10, 0])).toEqual([0, 7, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });
});

describe('priceCart', () => {
  it('totals subtotal + tax with no promo', () => {
    const result = priceCart(
      [
        { slug: 'a', subtotalMinor: 36_500 },
        { slug: 'b', subtotalMinor: 10_000 },
      ],
      null,
      5,
    );
    expect(result.subtotalMinor).toBe(46_500);
    expect(result.discountMinor).toBe(0);
    expect(result.taxMinor).toBe(1_825 + 500);
    expect(result.totalMinor).toBe(46_500 + 2_325);
  });

  it('applies the discount before tax and splits it across items', () => {
    const result = priceCart(
      [
        { slug: 'a', subtotalMinor: 30_000 },
        { slug: 'b', subtotalMinor: 10_000 },
      ],
      { type: 'percent', value: 10 },
      5,
    );
    expect(result.discountMinor).toBe(4_000);
    expect(result.items.map((i) => i.discountMinor)).toEqual([3_000, 1_000]);
    // (40000 - 4000) * 1.05
    expect(result.totalMinor).toBe(37_800);
    expect(result.items.reduce((s, i) => s + i.totalMinor, 0)).toBe(result.totalMinor);
  });

  it('limits the promo to listed activities', () => {
    const result = priceCart(
      [
        { slug: 'a', subtotalMinor: 30_000 },
        { slug: 'b', subtotalMinor: 10_000 },
      ],
      { type: 'percent', value: 10, appliesTo: ['b'] },
      0,
    );
    expect(result.items.map((i) => i.discountMinor)).toEqual([0, 1_000]);
    expect(result.totalMinor).toBe(39_000);
  });

  it('respects a cap and a fixed amount across rounding', () => {
    const capped = priceCart([{ slug: 'a', subtotalMinor: 100_000 }], { type: 'percent', value: 10, maxDiscount: 100 }, 5);
    expect(capped.discountMinor).toBe(10_000);
    const fixed = priceCart(
      [
        { slug: 'a', subtotalMinor: 3_333 },
        { slug: 'b', subtotalMinor: 3_333 },
        { slug: 'c', subtotalMinor: 3_334 },
      ],
      { type: 'fixed', value: 50 },
      5,
    );
    expect(fixed.discountMinor).toBe(5_000);
    expect(fixed.items.reduce((s, i) => s + i.discountMinor, 0)).toBe(5_000);
  });
});

describe('priceCart with a tax rate per line', () => {
  it('taxes each line with its own percent and still sums exactly', () => {
    const result = priceCart(
      [
        { slug: 'dubai', subtotalMinor: 10_000, taxPercent: 5 },
        { slug: 'kerala', subtotalMinor: 9_999, taxPercent: 18 },
        { slug: 'zero', subtotalMinor: 5_000, taxPercent: 0 },
      ],
      null,
      99,
    );
    expect(result.items.map((i) => i.taxMinor)).toEqual([500, 1_800, 0]);
    expect(result.taxMinor).toBe(2_300);
    expect(result.totalMinor).toBe(10_000 + 9_999 + 5_000 + 2_300);
    expect(result.items.reduce((s, i) => s + i.totalMinor, 0)).toBe(result.totalMinor);
  });

  it('falls back to the cart-wide percent for lines without one', () => {
    const result = priceCart([{ slug: 'a', subtotalMinor: 10_000 }, { slug: 'b', subtotalMinor: 10_000, taxPercent: 12 }], null, 5);
    expect(result.items.map((i) => i.taxMinor)).toEqual([500, 1_200]);
  });

  it('taxes the discounted amount of each line at its own rate', () => {
    const result = priceCart(
      [{ slug: 'a', subtotalMinor: 30_000, taxPercent: 5 }, { slug: 'b', subtotalMinor: 10_000, taxPercent: 18 }],
      { type: 'percent', value: 10 },
      0,
    );
    expect(result.items.map((i) => i.taxMinor)).toEqual([1_350, 1_620]);
    expect(result.totalMinor).toBe(27_000 + 9_000 + 2_970);
  });

  it('extracts tax from tax-inclusive lines without growing the total', () => {
    const result = priceCart([{ slug: 'a', subtotalMinor: 10_500, taxPercent: 5, taxInclusive: true }], null, 0);
    expect(result).toMatchObject({ taxMinor: 500, totalMinor: 10_500 });
    const odd = priceCart([{ slug: 'a', subtotalMinor: 10_000, taxPercent: 5, taxInclusive: true }], null, 0);
    expect(odd).toMatchObject({ taxMinor: 476, totalMinor: 10_000 });
  });
});

describe('holds', () => {
  it('expires hold minutes after now and counts only while in the future', () => {
    const now = new Date('2026-10-04T10:00:00.000Z');
    const expiry = holdExpiry(now, 10);
    expect(expiry.toISOString()).toBe('2026-10-04T10:10:00.000Z');
    expect(isHoldActive(expiry, new Date('2026-10-04T10:09:59.999Z'))).toBe(true);
    expect(isHoldActive(expiry, new Date('2026-10-04T10:10:00.000Z'))).toBe(false);
    expect(isHoldActive(undefined, now)).toBe(false);
  });
});

describe('generateOrderReference', () => {
  it('is OR- followed by 8 base32 characters and varies', () => {
    const refs = new Set(Array.from({ length: 50 }, () => generateOrderReference()));
    for (const ref of refs) expect(ref).toMatch(/^OR-[A-Z2-7]{8}$/);
    expect(refs.size).toBe(50);
  });
});
