import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { Refund } from '../bookings/schemas/refund.schema';
import { Order } from '../checkout/schemas/order.schema';
import { appError } from '../common/app-error';
import {
  buildDailyReconciliation,
  buildOverview,
  dayStartUtc,
  daysBetween,
  dubaiDay,
  type OrderPaidRow,
  type PaymentRow,
  type RefundRow,
} from './finance-rules';
import { FinanceRangeDto } from './finance.dto';

const MAX_DAYS = 366;
const ROW_CAP = 50_000;
const toMinor = (amount: number) => Math.round(amount * 100 + Math.sign(amount) * 1e-7);
const fromMinor = (minor: number) => minor / 100;

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Order.name) private readonly orders: Model<Order>,
  ) {}

  /** Resolves and validates the requested range (Asia/Dubai days). */
  range(query: FinanceRangeDto, now = new Date()) {
    const to = query.to ?? dubaiDay(now);
    const fromDay = query.from ?? dubaiDay(new Date(dayStartUtc(to).getTime() - 29 * 86_400_000));
    if (fromDay > to) throw appError(400, 'INVALID_RANGE', 'from must not be after to');
    if (daysBetween(fromDay, to).length > MAX_DAYS) {
      throw appError(400, 'RANGE_TOO_LARGE', `Choose a range of at most ${MAX_DAYS} days`);
    }
    return { from: fromDay, to, start: dayStartUtc(fromDay), end: new Date(dayStartUtc(to).getTime() + 86_400_000) };
  }

  private async load(range: ReturnType<FinanceService['range']>) {
    const [paid, refunded, orders, nonAed] = await Promise.all([
      this.bookings
        .find({ confirmedAt: { $gte: range.start, $lt: range.end }, currency: 'AED' })
        .select('reference orderReference paymentReference serviceType total tax discount partnerDiscount confirmedAt')
        .limit(ROW_CAP + 1)
        .lean()
        .exec(),
      this.refunds.find({ status: 'succeeded', createdAt: { $gte: range.start, $lt: range.end }, currency: 'AED' }).limit(ROW_CAP + 1).lean().exec(),
      this.orders.find({ status: 'paid', paidAt: { $gte: range.start, $lt: range.end }, currency: 'AED' }).select('orderReference totalMinor paidAt').limit(ROW_CAP + 1).lean().exec(),
      this.bookings.countDocuments({ confirmedAt: { $gte: range.start, $lt: range.end }, currency: { $ne: 'AED' } }).exec(),
    ]);
    const payments: PaymentRow[] = paid.map((b) => ({
      bookingId: b._id.toString(),
      reference: b.reference,
      orderReference: b.orderReference,
      paymentReference: b.paymentReference,
      serviceType: b.serviceType,
      amountMinor: toMinor(b.total),
      taxMinor: toMinor(b.tax ?? 0),
      discountMinor: toMinor(b.discount ?? b.partnerDiscount ?? 0),
      at: b.confirmedAt!,
    }));
    const refundRows: RefundRow[] = refunded.map((r) => ({
      id: r._id.toString(),
      bookingReference: r.bookingReference,
      orderReference: r.orderReference,
      paymentReference: r.paymentReference,
      mode: r.mode,
      amountMinor: r.amountMinor,
      at: r.createdAt,
    }));
    const orderRows: OrderPaidRow[] = orders.map((o) => ({ orderReference: o.orderReference, amountMinor: o.totalMinor, at: o.paidAt! }));
    return {
      payments,
      refunds: refundRows,
      orders: orderRows,
      excludedNonAed: nonAed,
      truncated: paid.length > ROW_CAP || refunded.length > ROW_CAP || orders.length > ROW_CAP,
    };
  }

  async overview(query: FinanceRangeDto, now = new Date()) {
    const range = this.range(query, now);
    const data = await this.load(range);
    const overview = buildOverview({ from: range.from, to: range.to, payments: data.payments, refunds: data.refunds });
    const pending = await this.bookings
      .aggregate<{ count: number; total: number }>([
        { $match: { status: BookingStatus.PendingPayment, currency: 'AED', holdExpiresAt: { $gt: now } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } },
      ])
      .exec();
    return {
      range: { from: range.from, to: range.to },
      currency: 'AED',
      collected: fromMinor(overview.collectedMinor),
      refunded: fromMinor(overview.refundedMinor),
      net: fromMinor(overview.netMinor),
      paymentsCount: overview.paymentsCount,
      refundsCount: overview.refundsCount,
      taxCollected: fromMinor(overview.taxMinor),
      discounts: fromMinor(overview.discountMinor),
      byDay: overview.byDay.map((d) => ({ date: d.date, collected: fromMinor(d.collectedMinor), refunded: fromMinor(d.refundedMinor), net: fromMinor(d.netMinor) })),
      byServiceType: overview.byServiceType.map((t) => ({ serviceType: t.serviceType, collected: fromMinor(t.collectedMinor), count: t.count })),
      outstanding: { count: pending[0]?.count ?? 0, amount: Math.round((pending[0]?.total ?? 0) * 100) / 100 },
      excludedNonAed: data.excludedNonAed,
      truncated: data.truncated,
    };
  }

  async reconciliation(query: FinanceRangeDto, now = new Date()) {
    const range = this.range(query, now);
    const data = await this.load(range);
    const { days, totals } = buildDailyReconciliation({ from: range.from, to: range.to, payments: data.payments, refunds: data.refunds, orders: data.orders });
    const money = (row: Omit<(typeof days)[number], 'date'>) => ({
      paymentsCount: row.paymentsCount,
      payments: fromMinor(row.paymentsMinor),
      refundsCount: row.refundsCount,
      refunds: fromMinor(row.refundsMinor),
      net: fromMinor(row.netMinor),
      orderLinkedPayments: fromMinor(row.orderLinkedPaymentsMinor),
      ordersPaidCount: row.ordersPaidCount,
      ordersPaid: fromMinor(row.ordersPaidMinor),
      variance: fromMinor(row.varianceMinor),
    });
    return {
      range: { from: range.from, to: range.to },
      currency: 'AED',
      days: days.map((d) => ({ date: d.date, ...money(d) })).reverse(),
      totals: money(totals),
      excludedNonAed: data.excludedNonAed,
      truncated: data.truncated,
    };
  }

  /** Individual payments and refunds of one day: the evidence behind a reconciliation row. */
  async dayLines(day: string) {
    const range = this.range({ from: day, to: day });
    const data = await this.load(range);
    return {
      date: day,
      currency: 'AED',
      payments: data.payments.map((p) => ({ type: 'payment', reference: p.reference, orderReference: p.orderReference ?? null, paymentReference: p.paymentReference ?? null, amount: fromMinor(p.amountMinor), at: p.at })),
      refunds: data.refunds.map((r) => ({ type: 'refund', reference: r.bookingReference, orderReference: r.orderReference ?? null, paymentReference: r.paymentReference ?? null, mode: r.mode, amount: fromMinor(r.amountMinor), at: r.at })),
      orders: data.orders.map((o) => ({ orderReference: o.orderReference, amount: fromMinor(o.amountMinor), at: o.at })),
    };
  }

  /** Rows of the lines CSV: every payment (+) and refund (-) in the range, oldest first. */
  async lineRows(query: FinanceRangeDto) {
    const range = this.range(query);
    const data = await this.load(range);
    return [
      ...data.payments.map((p) => ({ date: dubaiDay(p.at), at: p.at, type: 'payment', reference: p.reference, orderReference: p.orderReference, paymentReference: p.paymentReference, mode: '', amount: fromMinor(p.amountMinor) })),
      ...data.refunds.map((r) => ({ date: dubaiDay(r.at), at: r.at, type: 'refund', reference: r.bookingReference, orderReference: r.orderReference, paymentReference: r.paymentReference, mode: r.mode, amount: -fromMinor(r.amountMinor) })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
  }
}
