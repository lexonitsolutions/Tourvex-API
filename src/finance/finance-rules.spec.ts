import { buildDailyReconciliation, buildOverview, daysBetween, dubaiDay, type PaymentRow } from './finance-rules';

const pay = (over: Partial<PaymentRow>): PaymentRow => ({
  bookingId: 'b',
  reference: 'TVX-1',
  serviceType: 'activity',
  amountMinor: 10500,
  taxMinor: 500,
  discountMinor: 0,
  at: new Date('2026-10-05T10:00:00Z'),
  ...over,
});

describe('days', () => {
  it('buckets by Dubai day', () => {
    expect(dubaiDay(new Date('2026-10-05T19:59:59Z'))).toBe('2026-10-05');
    expect(dubaiDay(new Date('2026-10-05T20:00:00Z'))).toBe('2026-10-06');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('daily reconciliation', () => {
  const input = {
    from: '2026-10-05',
    to: '2026-10-07',
    payments: [
      pay({ orderReference: 'OR-AAAAAAAA' }),
      pay({ orderReference: 'OR-AAAAAAAA', amountMinor: 5000 }),
      pay({ amountMinor: 2000, at: new Date('2026-10-06T10:00:00Z') }),
    ],
    refunds: [{ id: 'r1', bookingReference: 'TVX-1', mode: 'mock', amountMinor: 3000, at: new Date('2026-10-06T12:00:00Z') }],
    orders: [{ orderReference: 'OR-AAAAAAAA', amountMinor: 15500, at: new Date('2026-10-05T10:00:00Z') }],
  };

  it('sums payments, refunds and net per day, with zero rows for quiet days', () => {
    const { days, totals } = buildDailyReconciliation(input);
    expect(days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(days[0]).toMatchObject({ paymentsCount: 2, paymentsMinor: 15500, refundsMinor: 0, netMinor: 15500 });
    expect(days[1]).toMatchObject({ paymentsMinor: 2000, refundsMinor: 3000, netMinor: -1000 });
    expect(days[2]).toMatchObject({ paymentsCount: 0, netMinor: 0 });
    expect(totals).toMatchObject({ paymentsMinor: 17500, refundsMinor: 3000, netMinor: 14500, paymentsCount: 3, refundsCount: 1 });
  });

  it('flags a variance when order-linked bookings and paid orders disagree', () => {
    expect(buildDailyReconciliation(input).days[0].varianceMinor).toBe(0);
    const off = buildDailyReconciliation({ ...input, orders: [{ orderReference: 'OR-AAAAAAAA', amountMinor: 15000, at: new Date('2026-10-05T10:00:00Z') }] });
    expect(off.days[0].varianceMinor).toBe(500);
  });

  it('ignores rows outside the range', () => {
    const { totals } = buildDailyReconciliation({ ...input, payments: [pay({ at: new Date('2026-09-01T10:00:00Z') })], refunds: [], orders: [] });
    expect(totals.paymentsMinor).toBe(0);
  });

  it('is exact for amounts that break floating point', () => {
    const payments = Array.from({ length: 10 }, () => pay({ amountMinor: 10 }));
    expect(buildDailyReconciliation({ from: '2026-10-05', to: '2026-10-05', payments, refunds: [], orders: [] }).totals.paymentsMinor).toBe(100);
  });
});

describe('overview', () => {
  it('collects, refunds, nets, and splits by service type', () => {
    const overview = buildOverview({
      from: '2026-10-05',
      to: '2026-10-06',
      payments: [pay({}), pay({ serviceType: 'visa', amountMinor: 20000, taxMinor: 0, discountMinor: 1000 })],
      refunds: [{ id: 'r', bookingReference: 'x', mode: 'stripe', amountMinor: 4500, at: new Date('2026-10-06T10:00:00Z') }],
    });
    expect(overview).toMatchObject({ collectedMinor: 30500, refundedMinor: 4500, netMinor: 26000, taxMinor: 500, discountMinor: 1000 });
    expect(overview.byServiceType.map((t) => t.serviceType)).toEqual(['visa', 'activity']);
    expect(overview.byDay[1]).toMatchObject({ date: '2026-10-06', refundedMinor: 4500 });
  });
});
