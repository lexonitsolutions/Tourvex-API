import { addSums, bookingFinancials, marginRow, retainedShare, taxOf } from './margin-rules';

describe('taxOf', () => {
  it('prefers the booking tax snapshot, then the invoice, then 0', () => {
    expect(taxOf({ total: 105, taxComponents: [{ taxAmount: 2.5 }, { taxAmount: 2.5 }], invoiceTax: 9 })).toBe(5);
    expect(taxOf({ total: 105, taxComponents: [], invoiceTax: 5 })).toBe(5);
    expect(taxOf({ total: 105, invoiceTax: null })).toBe(0);
    expect(taxOf({ total: 105 })).toBe(0);
  });

  it('never exceeds the total', () => {
    expect(taxOf({ total: 10, invoiceTax: 50 })).toBe(10);
  });
});

describe('retainedShare', () => {
  it('is the unrefunded part, between 0 and 1', () => {
    expect(retainedShare(200, 0)).toBe(1);
    expect(retainedShare(200, 50)).toBe(0.75);
    expect(retainedShare(200, 200)).toBe(0);
    expect(retainedShare(200, 500)).toBe(0);
    expect(retainedShare(0, 0)).toBe(0);
  });
});

describe('bookingFinancials', () => {
  it('revenue ex-tax = total - tax; margin = revenue - cost', () => {
    expect(bookingFinancials({ total: 105, tax: 5, cost: 60 })).toEqual({ revenueExTax: 100, taxTotal: 5, total: 105, cost: 60, margin: 40, marginPct: 40 });
  });

  it('subtracts refunds proportionally from revenue and tax', () => {
    const f = bookingFinancials({ total: 210, tax: 10, refundedAmount: 105, cost: 60 });
    expect(f).toMatchObject({ revenueExTax: 100, taxTotal: 5, cost: 60, margin: 40, marginPct: 40 });
    const full = bookingFinancials({ total: 210, tax: 10, refundedAmount: 210, cost: 60 });
    expect(full).toMatchObject({ revenueExTax: 0, taxTotal: 0, margin: -60, marginPct: null });
  });

  it('has no margin without a cost snapshot (a missing cost is not zero)', () => {
    expect(bookingFinancials({ total: 105, tax: 5, cost: null })).toMatchObject({ revenueExTax: 100, cost: null, margin: null, marginPct: null });
    expect(bookingFinancials({ total: 105, tax: 5, cost: 0 })).toMatchObject({ margin: 100, marginPct: 100 });
  });

  it('reports marginPct as a percentage with one decimal', () => {
    expect(bookingFinancials({ total: 200, tax: 0, refundedAmount: 50, cost: 80 })).toMatchObject({ revenueExTax: 150, margin: 70, marginPct: 46.7 });
  });
});

describe('marginRow / addSums', () => {
  const a = { bookings: 2, units: 5, revenueExTax: 300, taxTotal: 15, cost: 100, costedRevenue: 200, bookingsWithoutCost: 1 };
  const b = { bookings: 1, units: 1, revenueExTax: 50, taxTotal: 0, cost: 0, costedRevenue: 0, bookingsWithoutCost: 1 };

  it('margin and % only use the bookings that have a cost', () => {
    expect(marginRow(a)).toEqual({ bookings: 2, units: 5, revenueExTax: 300, taxTotal: 15, cost: 100, margin: 100, marginPct: 50, bookingsWithoutCost: 1 });
  });

  it('has no % when no booking has a cost', () => {
    expect(marginRow(b)).toMatchObject({ margin: 0, marginPct: null, bookingsWithoutCost: 1 });
  });

  it('totals add up the unrounded sums', () => {
    expect(marginRow(addSums([a, b]))).toMatchObject({ bookings: 3, revenueExTax: 350, cost: 100, margin: 100, marginPct: 50, bookingsWithoutCost: 2 });
  });
});
