import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BookingsService } from '../bookings/bookings.service';
import { BookingStatus } from '../bookings/schemas/booking.schema';
import { OrdersService } from '../checkout/orders.service';

@Injectable()
export class PaymentsService {
  private readonly stripe?: Stripe;
  private readonly mock: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly bookings: BookingsService,
    private readonly orders: OrdersService,
  ) {
    this.mock = config.get<string>('PAYMENTS_MOCK', 'true') === 'true';
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (!this.mock && !key) throw new Error('STRIPE_SECRET_KEY is required when PAYMENTS_MOCK=false');
    if (key) this.stripe = new Stripe(key);
  }

  get isMock(): boolean {
    return this.mock;
  }

  /** Whether the owner configured the publishable key; the key itself is never exposed by the API. */
  get publishableKeyConfigured(): boolean {
    return Boolean(this.config.get<string>('STRIPE_PUBLISHABLE_KEY'));
  }

  /** One PaymentIntent per order (idempotent by order reference); amount is in minor units. */
  async createOrderIntent(input: { orderReference: string; amountMinor: number; currency: string }) {
    const intent = await this.stripe!.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        metadata: { orderReference: input.orderReference },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `order:${input.orderReference}` },
    );
    return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  /**
   * Refunds part of a payment. A payment made in mock mode (pi_mock_...) is simulated; a Stripe
   * PaymentIntent (pi_...) is refunded through Stripe with the caller's idempotency key, so a retry
   * can never refund twice; any other reference (offline payment) is recorded as manual only.
   */
  async refundPayment(input: {
    paymentReference: string;
    amountMinor: number;
    idempotencyKey: string;
    bookingReference: string;
  }): Promise<{ mode: 'stripe' | 'mock' | 'manual'; providerRefundId?: string }> {
    const reference = input.paymentReference;
    if (reference.startsWith('pi_mock_')) return { mode: 'mock', providerRefundId: `re_mock_${input.idempotencyKey}`.slice(0, 60) };
    if (!reference.startsWith('pi_')) return { mode: 'manual' };
    if (!this.stripe) throw new BadRequestException('Stripe is not configured, so this payment cannot be refunded online');
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: reference,
        amount: input.amountMinor,
        metadata: { bookingReference: input.bookingReference },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { mode: 'stripe', providerRefundId: refund.id };
  }

  async getClientSecret(paymentIntentId: string) {
    const intent = await this.stripe!.paymentIntents.retrieve(paymentIntentId);
    return intent.client_secret;
  }

  /** Cancels an unpaid intent so it can no longer succeed. False when it cannot be cancelled (paid/processing). */
  async cancelOrderIntent(paymentIntentId: string): Promise<boolean> {
    try {
      await this.stripe!.paymentIntents.cancel(paymentIntentId);
      return true;
    } catch {
      const intent = await this.stripe!.paymentIntents.retrieve(paymentIntentId);
      return intent.status === 'canceled';
    }
  }

  async createIntent(bookingId: string, user: AuthenticatedUser) {
    const booking = await this.bookings.findAccessible(bookingId, user);
    if (booking.status !== BookingStatus.PendingPayment) {
      throw new BadRequestException('Booking is not awaiting payment');
    }
    if (this.mock) {
      const paymentReference = `pi_mock_${booking._id.toString()}`;
      const confirmed = await this.bookings.confirmPayment(booking._id.toString(), paymentReference);
      return { mode: 'mock', status: 'succeeded', paymentReference, booking: confirmed };
    }
    const intent = await this.stripe!.paymentIntents.create(
      {
        amount: this.toMinorUnits(booking.total, booking.currency),
        currency: booking.currency.toLowerCase(),
        metadata: { bookingId: booking._id.toString(), bookingReference: booking.reference },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `booking:${booking._id.toString()}` },
    );
    return { mode: 'stripe', paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  async handleWebhook(signature: string | undefined, rawBody: Buffer | undefined) {
    if (!this.stripe || !rawBody || !signature) throw new BadRequestException('Invalid Stripe webhook');
    const secret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const orderReference = intent.metadata.orderReference;
      const bookingId = intent.metadata.bookingId;
      if (orderReference) {
        await this.orders.confirmOrder(orderReference, intent.id, intent.amount_received);
      } else if (bookingId) {
        await this.bookings.confirmPayment(bookingId, intent.id);
      }
    }
    return { received: true };
  }

  private toMinorUnits(amount: number, currency: string) {
    const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
    return Math.round(amount * (zeroDecimal.has(currency.toUpperCase()) ? 1 : 100));
  }
}
