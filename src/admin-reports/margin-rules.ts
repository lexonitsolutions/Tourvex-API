/**
 * Revenue ex-tax, cost and margin of bookings (pure; the margin report's Mongo pipeline mirrors `bookingFinancials`).
 *
 * - tax: the booking tax snapshot (sum of its components) when present, else the invoice's tax, else 0;
 * - refunds: the retained share `(total - refunded) / total` applies to revenue ex-tax AND tax (a refund gives back
 *   the tax proportionally);
 * - cost: the cost snapshot total, or null when the booking has none (such bookings are counted in
 *   `bookingsWithoutCost` and left out of the margin and the margin percentage).
 */

export const round2 = (n: number): number => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
/** A percentage with one decimal: 42.5 means 42.5 %. */
export const pct1 = (n: number): number => Math.round((n + Math.sign(n) * 1e-9) * 10) / 10;

export interface TaxComponentLike {
  taxAmount?: number | null;
}

/** Tax of a booking: snapshot components, else the invoice tax, else 0; never more than the total. */
export function taxOf(input: { total: number; taxComponents?: readonly TaxComponentLike[] | null; invoiceTax?: number | null }): number {
  const snapshot = input.taxComponents?.length
    ? input.taxComponents.reduce((sum, component) => sum + (component.taxAmount ?? 0), 0)
    : null;
  const tax = snapshot ?? input.invoiceTax ?? 0;
  return Math.min(input.total, Math.max(0, tax));
}

/** Share of the booking that was not refunded, 0..1. */
export function retainedShare(total: number, refundedAmount = 0): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, (total - refundedAmount) / total));
}

export interface BookingFinancials {
  revenueExTax: number;
  taxTotal: number;
  total: number;
  cost: number | null;
  margin: number | null;
  /** Percent of revenue ex-tax (42.5 = 42.5 %); null without a cost or without revenue. */
  marginPct: number | null;
}

export function bookingFinancials(input: {
  total: number;
  tax: number;
  refundedAmount?: number | null;
  cost: number | null;
}): BookingFinancials {
  const share = retainedShare(input.total, input.refundedAmount ?? 0);
  const revenueExTax = round2((input.total - input.tax) * share);
  const taxTotal = round2(input.tax * share);
  const cost = input.cost === null ? null : round2(input.cost);
  const margin = cost === null ? null : round2(revenueExTax - cost);
  return {
    revenueExTax,
    taxTotal,
    total: round2(input.total),
    cost,
    margin,
    marginPct: margin === null || revenueExTax <= 0 ? null : pct1((margin / revenueExTax) * 100),
  };
}

/** Group sums out of the aggregation (`costedRevenue` = revenue ex-tax of the bookings that have a cost). */
export interface MarginSums {
  bookings: number;
  units: number;
  revenueExTax: number;
  taxTotal: number;
  cost: number;
  costedRevenue: number;
  bookingsWithoutCost: number;
}

export interface MarginRow {
  bookings: number;
  units: number;
  revenueExTax: number;
  taxTotal: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  bookingsWithoutCost: number;
}

/** margin = revenue of the costed bookings - cost; marginPct = margin / that revenue (null when no booking has a cost). */
export function marginRow(sums: MarginSums): MarginRow {
  const margin = round2(sums.costedRevenue - sums.cost);
  return {
    bookings: sums.bookings,
    units: sums.units,
    revenueExTax: round2(sums.revenueExTax),
    taxTotal: round2(sums.taxTotal),
    cost: round2(sums.cost),
    margin,
    marginPct: sums.costedRevenue > 0 && sums.bookingsWithoutCost < sums.bookings ? pct1((margin / sums.costedRevenue) * 100) : null,
    bookingsWithoutCost: sums.bookingsWithoutCost,
  };
}

export function addSums(rows: readonly MarginSums[]): MarginSums {
  const total: MarginSums = { bookings: 0, units: 0, revenueExTax: 0, taxTotal: 0, cost: 0, costedRevenue: 0, bookingsWithoutCost: 0 };
  for (const row of rows) {
    for (const key of Object.keys(total) as Array<keyof MarginSums>) total[key] += row[key];
  }
  return total;
}
