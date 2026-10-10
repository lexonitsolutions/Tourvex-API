import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model } from 'mongoose';
import { BookingsService } from '../bookings/bookings.service';
import { TransactionService } from '../common/database/transaction.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockService } from '../stock/stock.service';
import { CartSession } from './schemas/cart-session.schema';
import { Order } from './schemas/order.schema';
import { PromoCode } from './schemas/promo-code.schema';

/** How far back the reconciliation sweep looks for paid orders that were not finished. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60_000;
/** Leave a just-paid order alone for a moment: its own request is probably still finishing it. */
const RECONCILE_GRACE_MS = 2 * 60_000;

/**
 * Order state transitions that must be reachable from both checkout (mock payments) and the Stripe
 * webhook. Lives apart from CheckoutService so PaymentsModule can depend on it without a cycle.
 * Never logs personal data: only order/booking references.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(CartSession.name) private readonly carts: Model<CartSession>,
    @InjectModel(PromoCode.name) private readonly promos: Model<PromoCode>,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    private readonly transactions: TransactionService,
    private readonly stock: StockService,
  ) {}

  /**
   * Payment succeeded: pending_payment -> paid exactly once, then confirm every booking, close the
   * cart and count the promo. These database changes are ONE transaction, so a crash can never leave a
   * paid order with unconfirmed bookings. Invoices, vouchers and notices run after the commit; they are
   * idempotent and the reconciliation sweep repeats them if they failed. Repeating the call (webhook
   * retries) is safe. `paidAmountMinor`, when known, must equal the order total.
   */
  async confirmOrder(
    orderReference: string,
    paymentReference: string,
    paidAmountMinor?: number,
  ): Promise<{ fulfilled: boolean }> {
    const existing = await this.orders.findOne({ orderReference }).lean().exec();
    if (!existing) {
      this.logger.warn(`Payment ${paymentReference} references unknown order ${orderReference}`);
      return { fulfilled: false };
    }
    if (paidAmountMinor !== undefined && paidAmountMinor !== existing.totalMinor) {
      this.logger.error(`Order ${orderReference}: paid amount does not match the order total; not confirmed`);
      return { fulfilled: false };
    }

    const outcome = await this.transactions.run(async (session) => {
      const transitioned = await this.orders
        .findOneAndUpdate(
          { orderReference, status: 'pending_payment' },
          { $set: { status: 'paid', paymentReference, paidAt: new Date() } },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      // Read again inside the transaction: a concurrent webhook may have paid it a moment ago.
      const order =
        transitioned ?? (await this.orders.findOne({ orderReference, status: 'paid' }).session(session).lean().exec());
      if (!order) return null;

      const { flipped, settled } = await this.bookings.confirmOrderBookings(orderReference, paymentReference, session);
      await this.carts.updateOne({ _id: order.cartId }, { $set: { status: 'completed', active: false } }, { session }).exec();

      if (order.promoCode) {
        const counted = await this.orders
          .findOneAndUpdate({ _id: order._id, promoCounted: false }, { $set: { promoCounted: true } }, { session })
          .lean()
          .exec();
        if (counted) await this.promos.updateOne({ code: order.promoCode }, { $inc: { usedCount: 1 } }, { session }).exec();
      }
      return { newlyPaid: Boolean(transitioned), flipped, settled };
    });

    if (!outcome) {
      // Expired or cancelled before the payment arrived: the hold was released, so do not confirm.
      const current = await this.orders.findOne({ orderReference }).select('status').lean().exec();
      this.logger.error(
        `Order ${orderReference} was ${current?.status ?? 'missing'} when payment ${paymentReference} succeeded; needs manual review/refund`,
      );
      return { fulfilled: false };
    }

    await this.bookings.finalizeConfirmed(outcome.flipped, outcome.settled);
    // Ledger row + availability flags for the bookings that just turned paid (repeats of a webhook flip nothing).
    await this.stock.onBookingsConfirmed(outcome.flipped);
    if (outcome.newlyPaid) {
      for (const booking of outcome.flipped) {
        await this.notifications.bookingConfirmed({ bookingReference: booking.reference, orderReference });
      }
    }
    return { fulfilled: true };
  }

  /**
   * Safety net for the steps that run after the payment transaction (invoice, voucher): finds orders paid in the
   * last day whose bookings are still not fully finished and runs the same idempotent confirmation again.
   * Returns how many orders it repaired. Never throws; one broken order does not stop the rest.
   */
  async reconcilePaidOrders(now = new Date()): Promise<number> {
    let repaired = 0;
    try {
      const candidates = await this.orders
        .find({
          status: 'paid',
          paidAt: { $gte: new Date(now.getTime() - RECONCILE_WINDOW_MS), $lte: new Date(now.getTime() - RECONCILE_GRACE_MS) },
        })
        .select('orderReference paymentReference')
        .sort({ paidAt: 1 })
        .limit(200)
        .lean()
        .exec();
      for (const order of candidates) {
        try {
          if (!(await this.bookings.needsFinalizing(order.orderReference))) continue;
          const result = await this.confirmOrder(order.orderReference, order.paymentReference ?? `reconcile_${order.orderReference}`);
          if (result.fulfilled) {
            repaired += 1;
            this.logger.warn(`Reconciled order ${order.orderReference}: finished a payment that was left incomplete`);
          }
        } catch (error) {
          this.logger.error(`Reconciling order ${order.orderReference} failed: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Order reconciliation failed: ${(error as Error).message}`);
    }
    return repaired;
  }

  /**
   * Releases an unpaid order and its bookings. Returns expired:false when the order is no longer
   * pending (already paid), in which case nothing is touched.
   */
  async releaseOrder(
    orderReference: string,
    status: 'expired' | 'cancelled',
  ): Promise<{ released: boolean }> {
    const released = await this.orders
      .findOneAndUpdate(
        { orderReference, status: 'pending_payment' },
        { $set: { status, active: false } },
      )
      .lean()
      .exec();
    if (!released) return { released: false };
    await this.bookings.expireOrderBookings(orderReference);
    // The held units are free again: refresh the products' sold-out / low-stock flags.
    await this.stock.onOrderReleased(orderReference);
    return { released: true };
  }

  /**
   * One order per cart (unique while active). Inside a transaction (`session`) a duplicate aborts it and the
   * caller's retry finds the order; outside one, a concurrent duplicate returns the existing order.
   */
  async createOrder(data: Partial<Order> & { cartId: Order['cartId'] }, session?: ClientSession) {
    if (session) {
      const [created] = await this.orders.create([data], { session });
      return created;
    }
    try {
      return await this.orders.create(data);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.orders.findOne({ cartId: data.cartId, active: true }).exec();
      if (!existing) throw error;
      return existing;
    }
  }

  attachBookings(orderReference: string, bookingReferences: string[], session?: ClientSession) {
    return this.orders.updateOne({ orderReference }, { $set: { bookingReferences } }, { session }).exec();
  }

  attachPaymentIntent(orderReference: string, paymentIntentId: string) {
    return this.orders.updateOne({ orderReference }, { $set: { paymentIntentId } }).exec();
  }

  findByReference(orderReference: string) {
    return this.orders.findOne({ orderReference }).exec();
  }

  findByCart(cartId: string, session?: ClientSession) {
    return this.orders.findOne({ cartId, active: true }).session(session ?? null).exec();
  }
}
