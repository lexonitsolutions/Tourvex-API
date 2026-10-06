/**
 * Pure aggregation for the finance overview and the daily reconciliation. All money is integer
 * minor units (fils) so sums are exact; days are Asia/Dubai calendar days (UTC+4, no DST).
 */

const DUBAI_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

export const dubaiDay = (date: Date): string => new Date(date.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);

/** Start (inclusive) of a Dubai calendar day as a UTC instant. */
export const dayStartUtc = (day: string): Date => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - DUBAI_OFFSET_MS);

/** Every day from..to inclusive (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = new Date(`${from}T00:00:00.000Z`).getTime(); t <= new Date(`${to}T00:00:00.000Z`).getTime(); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export interface PaymentRow {
  bookingId: string;
  reference: string;
  orderReference?: string;
  paymentReference?: string;
  serviceType: string;
  amountMinor: number;
  taxMinor: number;
  discountMinor: number;
  at: Date;
}

export interface RefundRow {
  id: string;
  bookingReference: string;
  orderReference?: string;
  paymentReference?: string;
  mode: string;
  amountMinor: number;
  at: Date;
}

export interface OrderPaidRow {
  orderReference: string;
  amountMinor: number;
  at: Date;
}

export interface DayRow {
  date: string;
  paymentsCount: number;
  paymentsMinor: number;
  refundsCount: number;
  refundsMinor: number;
  netMinor: number;
  /** Payments of bookings that belong to an order. */
  orderLinkedPaymentsMinor: number;
  ordersPaidCount: number;
  ordersPaidMinor: number;
  /** order-linked booking payments minus orders paid: anything but 0 needs a look. */
  varianceMinor: number;
}

const emptyDay = (date: string): DayRow => ({
  date,
  paymentsCount: 0,
  paymentsMinor: 0,
  refundsCount: 0,
  refundsMinor: 0,
  netMinor: 0,
  orderLinkedPaymentsMinor: 0,
  ordersPaidCount: 0,
  ordersPaidMinor: 0,
  varianceMinor: 0,
});

/** One row per day in the range (zeros included), built from payments, refunds and paid orders. */
export function buildDailyReconciliation(input: {
  from: string;
  to: string;
  payments: readonly PaymentRow[];
  refunds: readonly RefundRow[];
  orders: readonly OrderPaidRow[];
}): { days: DayRow[]; totals: Omit<DayRow, 'date'> } {
  const byDay = new Map(daysBetween(input.from, input.to).map((day) => [day, emptyDay(day)]));
  for (const payment of input.payments) {
    const row = byDay.get(dubaiDay(payment.at));
    if (!row) continue;
    row.paymentsCount += 1;
    row.paymentsMinor += payment.amountMinor;
    if (payment.orderReference) row.orderLinkedPaymentsMinor += payment.amountMinor;
  }
  for (const refund of input.refunds) {
    const row = byDay.get(dubaiDay(refund.at));
    if (!row) continue;
    row.refundsCount += 1;
    row.refundsMinor += refund.amountMinor;
  }
  for (const order of input.orders) {
    const row = byDay.get(dubaiDay(order.at));
    if (!row) continue;
    row.ordersPaidCount += 1;
    row.ordersPaidMinor += order.amountMinor;
  }
  const days = [...byDay.values()];
  const totals: Omit<DayRow, 'date'> = {
    paymentsCount: 0,
    paymentsMinor: 0,
    refundsCount: 0,
    refundsMinor: 0,
    netMinor: 0,
    orderLinkedPaymentsMinor: 0,
    ordersPaidCount: 0,
    ordersPaidMinor: 0,
    varianceMinor: 0,
  };
  for (const row of days) {
    row.netMinor = row.paymentsMinor - row.refundsMinor;
    row.varianceMinor = row.orderLinkedPaymentsMinor - row.ordersPaidMinor;
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += row[key];
  }
  return { days, totals };
}

export interface Overview {
  collectedMinor: number;
  refundedMinor: number;
  netMinor: number;
  paymentsCount: number;
  refundsCount: number;
  taxMinor: number;
  discountMinor: number;
  byDay: { date: string; collectedMinor: number; refundedMinor: number; netMinor: number }[];
  byServiceType: { serviceType: string; collectedMinor: number; count: number }[];
}

export function buildOverview(input: {
  from: string;
  to: string;
  payments: readonly PaymentRow[];
  refunds: readonly RefundRow[];
}): Overview {
  const { days, totals } = buildDailyReconciliation({ ...input, orders: [] });
  const types = new Map<string, { collectedMinor: number; count: number }>();
  let taxMinor = 0;
  let discountMinor = 0;
  for (const payment of input.payments) {
    const entry = types.get(payment.serviceType) ?? { collectedMinor: 0, count: 0 };
    entry.collectedMinor += payment.amountMinor;
    entry.count += 1;
    types.set(payment.serviceType, entry);
    taxMinor += payment.taxMinor;
    discountMinor += payment.discountMinor;
  }
  return {
    collectedMinor: totals.paymentsMinor,
    refundedMinor: totals.refundsMinor,
    netMinor: totals.paymentsMinor - totals.refundsMinor,
    paymentsCount: totals.paymentsCount,
    refundsCount: totals.refundsCount,
    taxMinor,
    discountMinor,
    byDay: days.map((d) => ({ date: d.date, collectedMinor: d.paymentsMinor, refundedMinor: d.refundsMinor, netMinor: d.netMinor })),
    byServiceType: [...types.entries()]
      .map(([serviceType, value]) => ({ serviceType, ...value }))
      .sort((a, b) => b.collectedMinor - a.collectedMinor),
  };
}
