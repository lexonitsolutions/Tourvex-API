import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, QueryFilter, Types } from 'mongoose';
import { hasPermission } from '../admin/permissions';
import { operatingToday } from '../catalog/activity-booking.utils';
import { CatalogService } from '../catalog/catalog.service';
import { appError } from '../common/app-error';
import { ServiceType } from '../common/enums/service-type.enum';
import { appendNote, buildNote } from '../common/notes/notes';
import { buildPagination, escapeRegex, parseSort, skipFor } from '../common/query/paging-query.dto';
import { BillingService } from '../crm/billing/billing.service';
import { InventoryService } from '../crm/inventory/inventory.service';
import { Order } from '../checkout/schemas/order.schema';
import { BookingsService } from '../bookings/bookings.service';
import {
  assertCanPerform,
  assertRefundAmount,
  cancellationPolicy,
  canPerform,
  fromMinorUnits,
  isFutureOrToday,
  paymentStatusOf,
  refundableMinor,
  resolveCancellationRefund,
  statusAfterRefund,
  toMinorUnits,
  type RefundChoice,
} from '../bookings/booking-rules';
import { Booking, BookingEventType, BookingStatus } from '../bookings/schemas/booking.schema';
import { Refund } from '../bookings/schemas/refund.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { User } from '../users/schemas/user.schema';
import { VouchersService } from '../vouchers/vouchers.service';
import {
  ApproveCancellationDto,
  CancelBookingDto,
  ChangeServiceDateDto,
  ListBookingsDto,
  ListOrdersDto,
  RefundBookingDto,
} from './admin-bookings.dto';
import { buildTimeline, listItem } from './booking-view';

export interface Actor {
  id: string;
  email: string;
  roles: string[];
}

const BOOKING_SORTS = ['createdAt', 'serviceDate', 'total', 'status', 'reference', 'confirmedAt'] as const;

type BookingDoc = Booking & { _id: Types.ObjectId };

@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly bookingsService: BookingsService,
    private readonly vouchers: VouchersService,
    private readonly billing: BillingService,
    private readonly payments: PaymentsService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- lists

  async buildFilter(query: ListBookingsDto): Promise<QueryFilter<Booking>> {
    const and: QueryFilter<Booking>[] = [];
    if (query.status) and.push({ status: { $in: query.status.split(',') as BookingStatus[] } });
    if (query.serviceType) and.push({ serviceType: query.serviceType as ServiceType });
    if (query.activity) and.push({ activitySlug: query.activity });
    if (query.orderReference) and.push({ orderReference: query.orderReference });
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom && { $gte: new Date(query.createdFrom) }),
          ...(query.createdTo && { $lte: new Date(query.createdTo) }),
        },
      });
    }
    if (query.serviceFrom || query.serviceTo) {
      and.push({
        serviceDate: {
          ...(query.serviceFrom && { $gte: new Date(`${query.serviceFrom}T00:00:00.000Z`) }),
          ...(query.serviceTo && { $lte: new Date(`${query.serviceTo}T23:59:59.999Z`) }),
        },
      });
    }
    switch (query.paymentStatus) {
      case 'unpaid':
        and.push({ confirmedAt: { $exists: false } });
        break;
      case 'paid':
        and.push({ confirmedAt: { $exists: true } }, { $or: [{ refundedAmount: { $exists: false } }, { refundedAmount: 0 }] });
        break;
      case 'partially_refunded':
        and.push({ confirmedAt: { $exists: true }, refundedAmount: { $gt: 0 } }, { $expr: { $lt: ['$refundedAmount', '$total'] } });
        break;
      case 'refunded':
        and.push({ refundedAmount: { $gt: 0 } }, { $expr: { $gte: ['$refundedAmount', '$total'] } });
        break;
    }
    const q = query.q?.trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      // Legacy (sku) bookings carry no customer snapshot: match their users by name/e-mail too.
      const users = await this.users
        .find({ $or: [{ email: pattern }, { firstName: pattern }, { lastName: pattern }] })
        .select('_id')
        .limit(200)
        .lean()
        .exec();
      and.push({
        $or: [
          { reference: pattern },
          { orderReference: pattern },
          { 'customer.fullName': pattern },
          { 'customer.email': pattern },
          { title: pattern },
          ...(users.length ? [{ customerId: { $in: users.map((u) => u._id) } }] : []),
        ],
      });
    }
    return and.length ? { $and: and } : {};
  }

  async list(query: ListBookingsDto) {
    const filter = await this.buildFilter(query);
    const sort = parseSort(query.sort, BOOKING_SORTS, { field: 'createdAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.bookings.find(filter).sort(sort).skip(skipFor(query.page, query.limit)).limit(query.limit).lean().exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return { items: await this.withUsers(rows), pagination: buildPagination(query.page, query.limit, total) };
  }

  async *exportRows(query: ListBookingsDto) {
    const filter = await this.buildFilter(query);
    const sort = parseSort(query.sort, BOOKING_SORTS, { field: 'createdAt', dir: -1 });
    for (let page = 0; page < 100; page++) {
      const rows = await this.bookings.find(filter).sort(sort).skip(page * 100).limit(100).lean().exec();
      if (!rows.length) return;
      yield* await this.withUsers(rows);
      if (rows.length < 100) return;
    }
  }

  private async withUsers(rows: Booking[]) {
    const missing = rows.filter((row) => !row.customer).map((row) => row.customerId);
    const users = missing.length
      ? await this.users.find({ _id: { $in: missing } }).select('firstName lastName email').lean().exec()
      : [];
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    return rows.map((row) => listItem(row, byId.get(row.customerId.toString())));
  }

  /** Counts per status plus the activities that have bookings (options of the activity filter). */
  async summary() {
    const [rows, activities] = await Promise.all([
      this.bookings.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]).exec(),
      this.bookings
        .aggregate<{ _id: string; title: string; count: number }>([
          { $match: { activitySlug: { $exists: true } } },
          { $group: { _id: '$activitySlug', title: { $first: '$title' }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 200 },
        ])
        .exec(),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row._id] = row.count;
    return {
      byStatus,
      cancellationRequests: byStatus[BookingStatus.CancellationRequested] ?? 0,
      activities: activities.map((row) => ({ slug: row._id, title: row.title, count: row.count })),
    };
  }

  async listCancellationRequests(query: ListBookingsDto, now = new Date()) {
    const filter = await this.buildFilter({ ...query, status: BookingStatus.CancellationRequested });
    const [rows, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ cancellationRequestedAt: 1, updatedAt: 1, _id: 1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const items = (await this.withUsers(rows)).map((item, index) => {
      const row = rows[index];
      return {
        ...item,
        requestedAt: row.cancellationRequestedAt ?? row.updatedAt,
        freeCancellationUntil: row.freeCancellationUntil ?? null,
        policy: cancellationPolicy(row, now),
      };
    });
    return { items, pagination: buildPagination(query.page, query.limit, total) };
  }

  // --------------------------------------------------------------- orders

  async listOrders(query: ListOrdersDto) {
    const match: QueryFilter<Booking> = { orderReference: { $exists: true } };
    if (query.createdFrom || query.createdTo) {
      match.createdAt = {
        ...(query.createdFrom && { $gte: new Date(query.createdFrom) }),
        ...(query.createdTo && { $lte: new Date(query.createdTo) }),
      };
    }
    const q = query.q?.trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      match.$or = [{ orderReference: pattern }, { reference: pattern }, { 'customer.fullName': pattern }, { 'customer.email': pattern }];
    }
    const sortDir = query.sort === 'createdAt:asc' ? 1 : -1;
    const post: QueryFilter<unknown> = query.status ? { statuses: query.status } : {};
    const rows = await this.bookings
      .aggregate<{
        items: {
          _id: string;
          createdAt: Date;
          count: number;
          total: number;
          refunded: number;
          statuses: string[];
          customerName?: string;
          customerEmail?: string;
        }[];
        total: { n: number }[];
      }>([
        { $match: match },
        {
          $group: {
            _id: '$orderReference',
            createdAt: { $min: '$createdAt' },
            count: { $sum: 1 },
            total: { $sum: '$total' },
            refunded: { $sum: { $ifNull: ['$refundedAmount', 0] } },
            statuses: { $addToSet: '$status' },
            customerName: { $first: '$customer.fullName' },
            customerEmail: { $first: '$customer.email' },
          },
        },
        { $match: post },
        {
          $facet: {
            items: [{ $sort: { createdAt: sortDir, _id: sortDir } }, { $skip: skipFor(query.page, query.limit) }, { $limit: query.limit }],
            total: [{ $count: 'n' }],
          },
        },
      ])
      .exec();
    const { items, total } = rows[0] ?? { items: [], total: [] };
    return {
      items: items.map((item) => ({
        orderReference: item._id,
        createdAt: item.createdAt,
        bookings: item.count,
        total: Math.round(item.total * 100) / 100,
        refunded: Math.round(item.refunded * 100) / 100,
        status: item.statuses.length === 1 ? item.statuses[0] : 'mixed',
        statuses: item.statuses,
        customerName: item.customerName ?? null,
        customerEmail: item.customerEmail ?? null,
        currency: 'AED',
      })),
      pagination: buildPagination(query.page, query.limit, total[0]?.n ?? 0),
    };
  }

  async getOrder(orderReference: string) {
    const rows = await this.bookings.find({ orderReference }).sort({ createdAt: 1 }).lean().exec();
    if (!rows.length) throw appError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const order = await this.orders.findOne({ orderReference }).lean().exec();
    const items = await this.withUsers(rows);
    const sum = (pick: (b: Booking) => number) => Math.round(rows.reduce((t, b) => t + pick(b), 0) * 100) / 100;
    return {
      orderReference,
      status: new Set(rows.map((b) => b.status)).size === 1 ? rows[0].status : 'mixed',
      currency: rows[0].currency,
      subtotal: sum((b) => b.subtotal),
      discount: sum((b) => b.discount ?? 0),
      tax: sum((b) => b.tax),
      total: sum((b) => b.total),
      refunded: sum((b) => b.refundedAmount ?? 0),
      promoCode: order?.promoCode ?? rows.find((b) => b.promoCode)?.promoCode ?? null,
      paymentMode: order?.paymentMode ?? null,
      paymentReference: order?.paymentReference ?? rows.find((b) => b.paymentReference)?.paymentReference ?? null,
      paidAt: order?.paidAt ?? null,
      createdAt: rows[0].createdAt,
      customer: rows[0].customer ?? null,
      bookings: items,
    };
  }

  // --------------------------------------------------------------- detail

  private async load(id: string): Promise<BookingDoc> {
    const isObjectId = /^[a-f0-9]{24}$/i.test(id);
    const booking = await (isObjectId ? this.bookings.findById(id) : this.bookings.findOne({ reference: id })).lean().exec();
    if (!booking) throw appError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    return booking;
  }

  async get(id: string, actor: Actor, now = new Date()) {
    const booking = await this.load(id);
    const [user, refunds, voucher, invoice, creditNotes, order] = await Promise.all([
      this.users.findById(booking.customerId).select('firstName lastName email phone').lean().exec(),
      this.refunds.find({ bookingId: booking._id }).sort({ createdAt: 1 }).lean().exec(),
      this.vouchers.findByBooking(booking._id),
      this.billing.findInvoiceForBooking(booking._id),
      this.billing.creditNotesForBooking(booking._id),
      booking.orderReference ? this.orders.findOne({ orderReference: booking.orderReference }).lean().exec() : null,
    ]);
    const policy = cancellationPolicy(booking, now);
    const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(actor.roles, permission);
    return {
      ...listItem(booking, user),
      booking: {
        quantity: booking.quantity,
        unitPrice: booking.unitPrice,
        subtotal: booking.subtotal,
        discount: booking.discount ?? booking.partnerDiscount ?? 0,
        tax: booking.tax,
        total: booking.total,
        priceLines: booking.priceLines ?? [],
        promoCode: booking.promoCode ?? null,
        refundable: booking.refundable,
        freeCancellationUntil: booking.freeCancellationUntil ?? null,
        cancellationPolicy: booking.cancellationPolicy,
        paymentReference: booking.paymentReference ?? null,
        paymentMode: order?.paymentMode ?? (booking.paymentReference?.startsWith('pi_mock_') ? 'mock' : booking.paymentReference ? 'stripe' : null),
        transferType: booking.transferType ?? null,
        pickupRequired: booking.pickupRequired ?? false,
        pickup: booking.pickup ?? null,
        additional: booking.additional ?? null,
        activityLocation: booking.activityLocation ?? null,
        activityImage: booking.activityImage ?? null,
        sku: booking.sku ?? null,
        supplierReference: booking.supplierReference ?? null,
        holdExpiresAt: booking.holdExpiresAt ?? null,
        cancellationRequestedAt: booking.cancellationRequestedAt ?? null,
        cancelledAt: booking.cancelledAt ?? null,
      },
      customer: {
        id: booking.customerId.toString(),
        ...(booking.customer ?? {}),
        accountEmail: user?.email ?? null,
        accountName: user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : null,
      },
      refundable: {
        remaining: fromMinorUnits(refundableMinor(booking)),
        paymentStatus: paymentStatusOf(booking),
      },
      cancellationPolicyResult: policy,
      refunds: refunds.map((r) => this.refundView(r)),
      voucher: voucher ? this.vouchers.toView(voucher) : null,
      invoice: invoice ? this.billing.toView(invoice) : null,
      creditNotes: creditNotes.map((c) => this.billing.toView(c)),
      notes: (booking.notes ?? []).map((n) => ({ id: n.id, at: n.at, authorName: n.authorName, text: n.text })),
      timeline: buildTimeline(
        booking,
        refunds.map((r) => ({
          id: r._id.toString(),
          at: r.createdAt,
          amount: r.amount,
          currency: r.currency,
          status: r.status,
          mode: r.mode,
          reason: r.reason,
          actorEmail: r.actorEmail,
        })),
      ),
      actions: {
        confirm: canPerform('confirm', booking) && can('bookings.write'),
        cancel: canPerform('cancel', booking) && can('bookings.cancel'),
        approveCancellation: canPerform('approve_cancellation', booking) && can('bookings.cancel'),
        rejectCancellation: canPerform('reject_cancellation', booking) && can('bookings.cancel'),
        refund: canPerform('refund', booking) && can('bookings.refund'),
        resend: canPerform('resend', booking) && can('bookings.write'),
        editDate: canPerform('edit_date', booking) && can('bookings.write'),
        note: can('bookings.write'),
        refundWithCancel: can('bookings.refund'),
      },
    };
  }

  private refundView(refund: Refund) {
    return {
      id: refund._id.toString(),
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      mode: refund.mode,
      status: refund.status,
      providerRefundId: refund.providerRefundId ?? null,
      creditNoteNumber: refund.creditNoteNumber ?? null,
      actorEmail: refund.actorEmail ?? null,
      failureMessage: refund.failureMessage ?? null,
      createdAt: refund.createdAt,
    };
  }

  // ---------------------------------------------------------------- notes

  async addNote(id: string, text: string, actor: Actor) {
    const booking = await this.load(id);
    const note = buildNote({ id: actor.id, name: actor.email }, text);
    await this.bookings.updateOne({ _id: booking._id }, appendNote(note)).exec();
    return { id: note.id, at: note.at, authorName: note.authorName, text: note.text };
  }

  // -------------------------------------------------------------- actions

  /** Staff confirm: records an offline payment (the booking must still be inside its payment hold). */
  async confirm(id: string, paymentReference: string, actor: Actor, now = new Date()) {
    const booking = await this.load(id);
    assertCanPerform('confirm', booking);
    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < now.getTime()) {
      throw appError(409, 'HOLD_EXPIRED', 'The payment hold has expired, so the booking cannot be confirmed any more');
    }
    await this.bookingsService.confirmPayment(booking._id.toString(), paymentReference, { id: actor.id, name: actor.email });
    return this.afterChange(booking._id, actor, booking.status);
  }

  async cancel(id: string, dto: CancelBookingDto, actor: Actor, options: { approving?: boolean } = {}, now = new Date()) {
    const booking = await this.load(id);
    assertCanPerform(options.approving ? 'approve_cancellation' : 'cancel', booking);
    const choice: RefundChoice = dto.refund ?? 'policy';
    const refundAmount = booking.confirmedAt ? resolveCancellationRefund(booking, choice, dto.refundAmount, now) : 0;
    if (refundAmount > 0 && !hasPermission(actor.roles, 'bookings.refund')) {
      throw appError(403, 'REFUND_PERMISSION_REQUIRED', 'Cancelling with a refund needs the bookings.refund permission; cancel without a refund and let finance refund it');
    }
    const flipped = await this.bookings
      .findOneAndUpdate(
        { _id: booking._id, status: booking.status },
        {
          $set: { status: BookingStatus.Cancelled, cancelledAt: now },
          $push: { events: { type: 'cancelled', at: now, actorId: new Types.ObjectId(actor.id), actorName: actor.email, text: dto.reason.slice(0, 500) } },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!flipped) throw appError(409, 'CONFLICT', 'The booking changed while you were cancelling it; reload and try again');

    // Release stock for the legacy sku flow: unpaid = reserved, paid = sold.
    if (booking.sku) {
      try {
        if (booking.status === BookingStatus.PendingPayment) await this.inventory.release(booking.sku, booking.quantity);
        else await this.inventory.restock(booking.sku, booking.quantity);
      } catch (error) {
        this.logger.warn(`Stock release failed for ${booking.reference}: ${(error as Error).message}`);
      }
    }
    await this.vouchers.voidForBooking(booking._id, 'Booking cancelled', { id: actor.id, name: actor.email });

    let refundError: string | null = null;
    if (refundAmount > 0) {
      try {
        await this.refund(booking._id.toString(), { amount: refundAmount, reason: `Cancellation: ${dto.reason}` }, actor);
      } catch (error) {
        refundError = (error as Error).message;
        this.logger.error(`Refund after cancelling ${booking.reference} failed: ${refundError}`);
      }
    }
    return { ...(await this.afterChange(booking._id, actor, booking.status)), refundError };
  }

  async approveCancellation(id: string, dto: ApproveCancellationDto, actor: Actor) {
    return this.cancel(
      id,
      { reason: dto.note ? `Cancellation request approved. ${dto.note}` : 'Cancellation request approved', refund: dto.refund, refundAmount: dto.refundAmount },
      actor,
      { approving: true },
    );
  }

  async rejectCancellation(id: string, reason: string, actor: Actor) {
    const booking = await this.load(id);
    assertCanPerform('reject_cancellation', booking);
    const updated = await this.bookings
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.CancellationRequested },
        {
          $set: { status: BookingStatus.Confirmed },
          $unset: { cancellationRequestedAt: 1 },
          $push: { events: { type: 'cancellation_rejected', at: new Date(), actorId: new Types.ObjectId(actor.id), actorName: actor.email, text: reason.slice(0, 500) } },
        },
      )
      .lean()
      .exec();
    if (!updated) throw appError(409, 'CONFLICT', 'The booking changed; reload and try again');
    return this.afterChange(booking._id, actor, booking.status);
  }

  /**
   * Records a refund (ledger + Stripe/mock) without ever refunding twice: the amount is reserved on
   * the booking with ONE conditional atomic update (refunded + amount must stay <= total), the
   * provider call carries a deterministic idempotency key, and a failed provider call releases the
   * reservation again. A repeated client idempotencyKey returns the original ledger row.
   */
  async refund(id: string, dto: RefundBookingDto | { amount: number; reason: string; idempotencyKey?: string }, actor: Actor) {
    const booking = await this.load(id);
    if (dto.idempotencyKey) {
      const existing = await this.refunds.findOne({ idempotencyKey: `${booking._id.toString()}:${dto.idempotencyKey}` }).lean().exec();
      if (existing) return { refund: this.refundView(existing), replayed: true, booking: await this.get(booking._id.toString(), actor) };
    }
    assertCanPerform('refund', booking);
    const amountMinor = assertRefundAmount(booking, dto.amount);
    const amount = fromMinorUnits(amountMinor);

    const reserved = await this.bookings
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: { $in: [BookingStatus.Confirmed, BookingStatus.CancellationRequested, BookingStatus.Cancelled] },
          confirmedAt: { $exists: true },
          $expr: { $lte: [{ $round: [{ $add: [{ $ifNull: ['$refundedAmount', 0] }, amount] }, 2] }, { $round: ['$total', 2] }] },
        },
        [{ $set: { refundedAmount: { $round: [{ $add: [{ $ifNull: ['$refundedAmount', 0] }, amount] }, 2] } } }],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean()
      .exec();
    if (!reserved) {
      throw appError(409, 'REFUND_EXCEEDS_PAID', 'The refund exceeds what is still refundable (or the booking changed); reload and try again');
    }
    const refundedAfterMinor = toMinorUnits(reserved.refundedAmount ?? 0);
    const refundedBeforeMinor = refundedAfterMinor - amountMinor;
    const release = () =>
      this.bookings
        .updateOne({ _id: booking._id }, [{ $set: { refundedAmount: { $round: [{ $max: [0, { $subtract: [{ $ifNull: ['$refundedAmount', 0] }, amount] }] }, 2] } } }], { updatePipeline: true })
        .exec();

    const idempotencyKey = dto.idempotencyKey ? `${booking._id.toString()}:${dto.idempotencyKey}` : undefined;
    let row: HydratedDocument<Refund>;
    try {
      row = await this.refunds.create({
        bookingId: booking._id,
        bookingReference: booking.reference,
        orderReference: booking.orderReference,
        amount,
        amountMinor,
        currency: booking.currency,
        reason: dto.reason,
        mode: 'manual',
        status: 'pending',
        paymentReference: booking.paymentReference,
        idempotencyKey,
        actorId: new Types.ObjectId(actor.id),
        actorEmail: actor.email,
      });
    } catch (error) {
      await release();
      if ((error as { code?: number }).code === 11000 && idempotencyKey) {
        const existing = await this.refunds.findOne({ idempotencyKey }).lean().exec();
        if (existing) return { refund: this.refundView(existing), replayed: true, booking: await this.get(booking._id.toString(), actor) };
      }
      throw error;
    }

    let provider: Awaited<ReturnType<PaymentsService['refundPayment']>>;
    try {
      provider = await this.payments.refundPayment({
        paymentReference: booking.paymentReference ?? '',
        amountMinor,
        idempotencyKey: `refund:${booking._id.toString()}:${refundedBeforeMinor}:${amountMinor}${dto.idempotencyKey ? `:${dto.idempotencyKey}` : ''}`,
        bookingReference: booking.reference,
      });
    } catch (error) {
      await release();
      await this.refunds.updateOne({ _id: row._id }, { $set: { status: 'failed', failureMessage: (error as Error).message.slice(0, 300) } }).exec();
      throw appError(502, 'REFUND_FAILED', `The payment provider could not refund this amount: ${(error as Error).message}`);
    }

    const now = new Date();
    const fully = refundedAfterMinor >= toMinorUnits(booking.total);
    const nextStatus = statusAfterRefund(booking.status, toMinorUnits(booking.total), refundedAfterMinor);
    await this.refunds
      .updateOne({ _id: row._id }, { $set: { status: 'succeeded', mode: provider.mode, providerRefundId: provider.providerRefundId } })
      .exec();
    await this.bookings
      .updateOne(
        { _id: booking._id },
        {
          ...(nextStatus !== booking.status && { $set: { status: nextStatus } }),
          $push: { events: { type: 'refunded' as BookingEventType, at: now, actorId: new Types.ObjectId(actor.id), actorName: actor.email, text: `${booking.currency} ${amount.toFixed(2)}: ${dto.reason}`.slice(0, 500) } },
        },
      )
      .exec();
    if (fully) await this.vouchers.voidForBooking(booking._id, 'Booking refunded', { id: actor.id, name: actor.email });

    try {
      const note = await this.billing.createCreditNote({
        booking: booking,
        refundId: row._id,
        refundMinor: amountMinor,
        alreadyRefundedMinor: refundedBeforeMinor,
        reason: dto.reason,
      });
      await this.refunds.updateOne({ _id: row._id }, { $set: { creditNoteNumber: note.invoiceNumber } }).exec();
    } catch (error) {
      this.logger.error(`Credit note for refund ${row._id.toString()} failed: ${(error as Error).message}`);
    }
    const saved = await this.refunds.findById(row._id).lean().exec();
    return { refund: this.refundView(saved!), replayed: false, booking: await this.get(booking._id.toString(), actor) };
  }

  async resend(id: string, actor: Actor) {
    const booking = await this.load(id);
    assertCanPerform('resend', booking);
    const voucher = (await this.vouchers.findByBooking(booking._id)) ?? (await this.vouchers.issueForBooking(booking));
    if (voucher && voucher.status === 'issued') {
      await this.vouchers.resend(voucher._id.toString(), { id: actor.id, name: actor.email });
    } else {
      await this.notifications.bookingConfirmed({ bookingReference: booking.reference, orderReference: booking.orderReference });
    }
    await this.bookings
      .updateOne({ _id: booking._id }, { $push: { events: { type: 'confirmation_resent', at: new Date(), actorId: new Types.ObjectId(actor.id), actorName: actor.email } } })
      .exec();
    return this.afterChange(booking._id, actor, booking.status);
  }

  /** Moves an activity booking to another day after re-checking availability, pax and cut-off. */
  async changeServiceDate(id: string, dto: ChangeServiceDateDto, actor: Actor, now = new Date()) {
    const booking = await this.load(id);
    assertCanPerform('edit_date', booking);
    if (dto.date === booking.serviceDay) throw appError(400, 'SAME_DATE', 'The booking is already on that date');
    if (!isFutureOrToday(dto.date, operatingToday(now))) throw appError(400, 'INVALID_DATE', 'The new date cannot be in the past');
    const voucher = await this.vouchers.findByBooking(booking._id);
    if (voucher?.status === 'redeemed') throw appError(409, 'ALREADY_REDEEMED', 'The voucher was already used, so the date cannot be changed');
    // Throws DATE_UNAVAILABLE / PAX_LIMIT / OPTION_NOT_FOUND exactly like the customer flow.
    await this.catalog.prepareItem(
      booking.activitySlug!,
      { optionId: booking.optionId!, date: dto.date, adults: booking.adults ?? booking.quantity, children: booking.children ?? 0 },
      now,
    );
    const updated = await this.bookings
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.Confirmed, serviceDay: booking.serviceDay },
        {
          $set: { serviceDay: dto.date, serviceDate: new Date(`${dto.date}T00:00:00.000Z`) },
          $push: {
            events: {
              type: 'service_date_changed',
              at: now,
              actorId: new Types.ObjectId(actor.id),
              actorName: actor.email,
              text: `${booking.serviceDay} to ${dto.date}: ${dto.reason}`.slice(0, 500),
            },
          },
        },
      )
      .lean()
      .exec();
    if (!updated) throw appError(409, 'CONFLICT', 'The booking changed; reload and try again');
    return this.afterChange(booking._id, actor, booking.status, { field: 'serviceDay', from: booking.serviceDay ?? null, to: dto.date });
  }

  private async afterChange(id: Types.ObjectId, actor: Actor, previousStatus: string, change?: { field: string; from: unknown; to: unknown }) {
    const view = await this.get(id.toString(), actor);
    return { ...view, previousStatus, ...(change && { change }) };
  }
}
