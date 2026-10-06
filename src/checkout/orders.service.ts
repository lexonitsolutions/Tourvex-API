import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CartSession } from './schemas/cart-session.schema';
import { Order } from './schemas/order.schema';
import { PromoCode } from './schemas/promo-code.schema';

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
  ) {}

  /**
   * Payment succeeded: pending_payment -> paid exactly once, then confirm every booking, close the
   * cart, count the promo and send the voucher notice. Repeating the call (webhook retries) only
   * re-runs the idempotent steps. `paidAmountMinor`, when known, must equal the order total.
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

    const transitioned = await this.orders
      .findOneAndUpdate(
        { orderReference, status: 'pending_payment' },
        { $set: { status: 'paid', paymentReference, paidAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    const order = transitioned ?? (existing.status === 'paid' ? existing : null);
    if (!order) {
      // Expired or cancelled before the payment arrived: the hold was released, so do not confirm.
      this.logger.error(
        `Order ${orderReference} was ${existing.status} when payment ${paymentReference} succeeded; needs manual review/refund`,
      );
      return { fulfilled: false };
    }

    const confirmed = await this.bookings.confirmOrderPayment(orderReference, paymentReference);
    await this.carts
      .updateOne({ _id: order.cartId }, { $set: { status: 'completed', active: false } })
      .exec();

    if (order.promoCode) {
      const counted = await this.orders
        .findOneAndUpdate({ _id: order._id, promoCounted: false }, { $set: { promoCounted: true } })
        .lean()
        .exec();
      if (counted) {
        await this.promos.updateOne({ code: order.promoCode }, { $inc: { usedCount: 1 } }).exec();
      }
    }

    if (transitioned) {
      for (const booking of confirmed) {
        await this.notifications.bookingConfirmed({
          bookingReference: booking.reference,
          orderReference,
        });
      }
    }
    return { fulfilled: true };
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
    return { released: true };
  }

  /** One order per cart (unique while active); a concurrent duplicate returns the existing one. */
  async createOrder(data: Partial<Order> & { cartId: Order['cartId'] }) {
    try {
      return await this.orders.create(data);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.orders.findOne({ cartId: data.cartId, active: true }).exec();
      if (!existing) throw error;
      return existing;
    }
  }

  attachBookings(orderReference: string, bookingReferences: string[]) {
    return this.orders.updateOne({ orderReference }, { $set: { bookingReferences } }).exec();
  }

  attachPaymentIntent(orderReference: string, paymentIntentId: string) {
    return this.orders.updateOne({ orderReference }, { $set: { paymentIntentId } }).exec();
  }

  findByReference(orderReference: string) {
    return this.orders.findOne({ orderReference }).exec();
  }

  findByCart(cartId: string) {
    return this.orders.findOne({ cartId, active: true }).exec();
  }
}
