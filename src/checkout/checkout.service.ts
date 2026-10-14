import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { BookingsService } from '../bookings/bookings.service';
import { ActivityCapacityService } from '../catalog/activity-capacity.service';
import { CatalogService, type PreparedItem } from '../catalog/catalog.service';
import { appError } from '../common/app-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TransactionService } from '../common/database/transaction.service';
import { SettingsService } from '../admin/settings/settings.service';
import { CurrencyService } from '../currency/currency.service';
import { indicativeDisplay } from '../currency/display';
import { shouldExposeSamples } from '../holidays/holidays.utils';
import { bookingTaxFields } from '../tax/tax-snapshot';
import type { TaxDetermination } from '../tax/tax.rules';
import { TaxService } from '../tax/tax.service';
import { PaymentsService } from '../payments/payments.service';
import {
  CURRENCY,
  fromMinor,
  generateOrderReference,
  holdExpiry,
  moneyOf,
  priceCart,
  promoRejection,
} from './checkout-pricing';
import {
  AdditionalDto,
  ApplyPromoDto,
  CartItemDto,
  CustomerDto,
  PickupDto,
} from './dto/checkout.dto';
import { OrdersService } from './orders.service';
import { CartItem, CartSession, CartSessionDocument } from './schemas/cart-session.schema';
import { PromoCode } from './schemas/promo-code.schema';
import { PackageCartService, type PackageType } from './package-cart.service';

export const MAX_CART_ITEMS = 5;
/** A just-completed cart still answers a repeated pay request with the same result. */
const COMPLETED_REPLAY_MS = 15 * 60_000;

type PlainCart = CartSession;

@Injectable()
export class CheckoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly sweepSeconds: number;
  private readonly isTest: boolean;
  private readonly sampleVisible: boolean;
  private timer?: NodeJS.Timeout;
  private ticks = 0;

  constructor(
    @InjectModel(CartSession.name) private readonly carts: Model<CartSession>,
    @InjectModel(PromoCode.name) private readonly promos: Model<PromoCode>,
    private readonly orders: OrdersService,
    private readonly bookings: BookingsService,
    private readonly catalog: CatalogService,
    private readonly packages: PackageCartService,
    private readonly payments: PaymentsService,
    private readonly currency: CurrencyService,
    private readonly settings: SettingsService,
    private readonly capacity: ActivityCapacityService,
    private readonly transactions: TransactionService,
    private readonly tax: TaxService,
    config: ConfigService,
  ) {
    this.sweepSeconds = config.get<number>('CHECKOUT_SWEEP_SECONDS', 60);
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isTest = nodeEnv === 'test';
    this.sampleVisible = shouldExposeSamples(nodeEnv, config.get<string>('ACTIVITY_SAMPLE_DETAILS'));
  }

  /** Cart hold length; the admin-editable commerce setting (env CHECKOUT_HOLD_MINUTES is the default). */
  private async holdMinutes(): Promise<number> {
    return (await this.settings.getCommerce()).holdMinutes;
  }

  onModuleInit() {
    if (this.isTest) return;
    this.timer = setInterval(() => {
      void this.sweep();
      // Every fifth tick (5 minutes by default): finish payments whose invoice/voucher step failed.
      if (++this.ticks % 5 === 0) {
        void this.orders.reconcilePaidOrders();
        // ...and e-mail invoices / credit notes whose first send failed (backoff, max 5 attempts).
        void this.bookings.retryInvoiceEmails();
      }
    }, this.sweepSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- reads

  /** Current cart, or the empty shape (never 404). Expired items are reported once. */
  async getCart(user: AuthenticatedUser, display?: string) {
    const cart = await this.loadActive(user.sub, new Date());
    if (cart) return this.sessionView(cart.toObject(), display);

    const dropped = await this.carts
      .findOne({ userId: new Types.ObjectId(user.sub), status: 'expired', expiredNoticePending: true })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    if (!dropped) return this.emptyView();
    await this.carts
      .updateMany(
        { userId: new Types.ObjectId(user.sub), expiredNoticePending: true },
        { $set: { expiredNoticePending: false } },
      )
      .exec();
    return this.emptyView(dropped.items, display);
  }

  async getSession(user: AuthenticatedUser, id: string, display?: string) {
    const cart = await this.loadOwned(user.sub, id);
    return this.sessionView(cart.toObject(), display);
  }

  async getSessionStatus(user: AuthenticatedUser, id: string) {
    return this.statusOf(await this.loadOwned(user.sub, id));
  }

  /** Status of the user's latest cart (the active one, or the one just completed/expired). */
  async getCartStatus(user: AuthenticatedUser) {
    const latest = await this.carts
      .findOne({ userId: new Types.ObjectId(user.sub) })
      .sort({ createdAt: -1 })
      .exec();
    if (!latest) return { status: 'open' as const, items: 0 };
    if (latest.active) {
      const fresh = await this.loadActive(user.sub, new Date());
      return fresh ? this.statusOf(fresh) : this.statusOf((await this.carts.findById(latest._id).exec())!);
    }
    return this.statusOf(latest);
  }

  // ------------------------------------------------------------ cart items

  async addItem(user: AuthenticatedUser, dto: CartItemDto, display?: string) {
    const now = new Date();
    const cart = await this.loadForEdit(user.sub, now);
    const same = cart?.items.find((i) => this.sameKey(i, dto));
    const itemId = same?.itemId ?? randomUUID();
    if (cart && !same && cart.items.length >= MAX_CART_ITEMS) {
      throw appError(409, 'CART_FULL', `A cart can hold at most ${MAX_CART_ITEMS} activities`);
    }
    const prepared = await this.prepare(dto, itemId, now, cart?._id.toString());
    // Adding the same option + date again REPLACES that item (travellers are set, not summed), so
    // a repeated "Proceed to pay" click is idempotent. Pick-up and additional details are kept.
    const item = this.buildItem(prepared, dto, itemId, same);

    if (!cart) {
      const created = new this.carts({
        userId: new Types.ObjectId(user.sub),
        status: 'open',
        active: true,
        items: [item],
        expiresAt: holdExpiry(now, await this.holdMinutes()),
      });
      const items = [item];
      await this.applyPricing(created, items, now);
      created.set('items', items);
      await this.save(created);
      return this.sessionView(created.toObject(), display);
    }
    const items = cart.toObject().items.filter((i) => i.itemId !== item.itemId);
    items.push(item);
    return this.commitItems(cart, items, now, display);
  }

  async modifyItem(user: AuthenticatedUser, itemId: string, dto: CartItemDto, display?: string) {
    const now = new Date();
    const cart = await this.requireForEdit(user.sub, now);
    const current = cart.items.find((i) => i.itemId === itemId);
    if (!current) throw appError(404, 'ITEM_NOT_FOUND', 'Cart item not found');
    if (cart.items.some((i) => i.itemId !== itemId && this.sameKey(i, dto))) {
      throw appError(409, 'DUPLICATE_ITEM', 'Another item in your cart already has this option and date');
    }
    const prepared = await this.prepare(dto, itemId, now, cart._id.toString());
    const item = this.buildItem(prepared, dto, itemId, current);
    const items = cart.toObject().items.map((i) => (i.itemId === itemId ? item : i));
    return this.commitItems(cart, items, now, display);
  }

  async removeItem(user: AuthenticatedUser, itemId: string, display?: string) {
    const now = new Date();
    const cart = await this.requireForEdit(user.sub, now);
    if (!cart.items.some((i) => i.itemId === itemId)) {
      throw appError(404, 'ITEM_NOT_FOUND', 'Cart item not found');
    }
    const items = cart.toObject().items.filter((i) => i.itemId !== itemId);
    if (items.length === 0) {
      await this.carts.deleteOne({ _id: cart._id }).exec();
      return this.emptyView();
    }
    return this.commitItems(cart, items, now, display);
  }

  async setPickup(user: AuthenticatedUser, itemId: string, dto: PickupDto, display?: string) {
    const cart = await this.requireForEdit(user.sub, new Date());
    const items = cart.toObject().items;
    const item = items.find((i) => i.itemId === itemId);
    if (!item) throw appError(404, 'ITEM_NOT_FOUND', 'Cart item not found');
    if (!item.pickupRequired) {
      throw appError(400, 'PICKUP_NOT_REQUIRED', 'This option does not need a pick-up location');
    }
    item.pickup =
      dto.mode === 'later'
        ? { mode: 'later' }
        : {
            mode: 'now',
            locationName: dto.locationName,
            address: dto.address,
            ...(dto.lat !== undefined && { lat: dto.lat }),
            ...(dto.lng !== undefined && { lng: dto.lng }),
            ...(dto.notes && { notes: dto.notes }),
          };
    cart.set('items', items);
    await this.save(cart);
    return this.sessionView(cart.toObject(), display);
  }

  async setAdditional(user: AuthenticatedUser, itemId: string, dto: AdditionalDto, display?: string) {
    const cart = await this.requireForEdit(user.sub, new Date());
    const items = cart.toObject().items;
    const item = items.find((i) => i.itemId === itemId);
    if (!item) throw appError(404, 'ITEM_NOT_FOUND', 'Cart item not found');
    const names = dto.leadTravellerNames ?? [];
    if (names.length > item.adults + item.children) {
      throw appError(400, 'TOO_MANY_NAMES', 'More traveller names than travellers on this item');
    }
    item.additional = {
      leadTravellerNames: names,
      ...(dto.specialRequests && { specialRequests: dto.specialRequests }),
      ...(dto.arrivalFlight && { arrivalFlight: dto.arrivalFlight }),
      ...(dto.hotelName && { hotelName: dto.hotelName }),
    };
    cart.set('items', items);
    await this.save(cart);
    return this.sessionView(cart.toObject(), display);
  }

  async setCustomer(user: AuthenticatedUser, dto: CustomerDto, display?: string) {
    const cart = await this.requireForEdit(user.sub, new Date());
    cart.customer = {
      fullName: dto.fullName,
      email: dto.email.toLowerCase(),
      phoneCountryCode: dto.phoneCountryCode,
      phone: dto.phone,
      nationality: dto.nationality,
      marketingOptOut: dto.marketingOptOut,
    };
    await this.save(cart);
    return this.sessionView(cart.toObject(), display);
  }

  // ----------------------------------------------------------------- promo

  async applyPromo(user: AuthenticatedUser, dto: ApplyPromoDto, display?: string) {
    const now = new Date();
    const cart = await this.requireForEdit(user.sub, now);
    const promo = await this.promos.findOne({ code: dto.code }).lean().exec();
    const invalid = appError(400, 'INVALID_PROMO', 'This promo code is not valid for your cart');
    if (!promo || this.promoProblem(promo, now)) throw invalid;
    cart.promoCode = promo.code;
    const items = cart.toObject().items;
    await this.applyPricing(cart, items, now);
    if (!cart.promoCode) throw invalid; // no discount for this cart (spend/activity rules)
    cart.set('items', items);
    await this.save(cart);
    return this.sessionView(cart.toObject(), display);
  }

  async removePromo(user: AuthenticatedUser, display?: string) {
    const now = new Date();
    const cart = await this.requireForEdit(user.sub, now);
    cart.promoCode = undefined;
    const items = cart.toObject().items;
    await this.applyPricing(cart, items, now);
    cart.set('items', items);
    await this.save(cart);
    return this.sessionView(cart.toObject(), display);
  }

  // ------------------------------------------------------------------- pay

  /**
   * Creates the order (one Booking per item, one payment for the total) and starts payment.
   * Idempotent: repeating it returns the same order and the same PaymentIntent.
   */
  async pay(user: AuthenticatedUser) {
    const now = new Date();
    const cart = await this.loadActive(user.sub, now);
    if (!cart) {
      const replay = await this.completedReplay(user.sub, now);
      if (replay) return replay;
      throw appError(400, 'CART_EMPTY', 'Your cart is empty or has expired');
    }
    if (cart.items.length === 0) throw appError(400, 'CART_EMPTY', 'Your cart is empty');

    if (cart.status === 'open') {
      const before = cart.promoCode;
      // Re-validate availability and re-price every item on the server before taking payment.
      const items = [];
      for (const old of cart.toObject().items) {
        const prepared = await this.prepare(
          { productType: old.productType, productSlug: old.productSlug, activitySlug: old.activitySlug, bookingOnly: old.bookingOnly, optionId: old.optionId, date: old.date, adults: old.adults, children: old.children },
          old.itemId, now, cart._id.toString(),
        );
        items.push(
          this.buildItem(
            prepared,
            { productType: old.productType, productSlug: old.productSlug, activitySlug: old.activitySlug, bookingOnly: old.bookingOnly, optionId: old.optionId, date: old.date, adults: old.adults, children: old.children },
            old.itemId,
            old,
          ),
        );
      }
      const steps = this.steps(items, cart.customer);
      if (!steps.pickup || !steps.additional || !steps.customer) {
        throw appError(400, 'STEPS_INCOMPLETE', 'Complete pick-up, additional and customer details before paying');
      }
      await this.applyPricing(cart, items, now);
      if (before && !cart.promoCode) {
        throw appError(409, 'PROMO_NO_LONGER_VALID', 'Your promo code is no longer valid; review your cart total');
      }
      if (cart.totalMinor <= 0) throw appError(400, 'INVALID_TOTAL', 'The order total must be greater than zero');
      cart.set('items', items);
      // Give the payment step a fresh window; bookings below hold capacity until it ends.
      cart.expiresAt = holdExpiry(now, await this.holdMinutes());
      cart.status = 'awaiting_payment';
      await this.save(cart);
    }

    const order = await this.ensureOrder(cart);
    cart.orderReference = order.orderReference;
    const bookingReferences = order.bookingReferences;
    const base = { orderReference: order.orderReference, sessionId: cart._id.toString() };
    const first = { bookingReference: bookingReferences[0], bookingReferences };

    if (this.payments.isMock) {
      await this.orders.confirmOrder(order.orderReference, `pi_mock_${order.orderReference}`);
      return { mode: 'mock' as const, status: 'succeeded' as const, ...first, ...base };
    }
    let paymentIntentId = order.paymentIntentId;
    let clientSecret: string | null;
    if (paymentIntentId) {
      clientSecret = await this.payments.getClientSecret(paymentIntentId);
    } else {
      const intent = await this.payments.createOrderIntent({
        orderReference: order.orderReference,
        amountMinor: order.totalMinor,
        currency: CURRENCY,
      });
      paymentIntentId = intent.paymentIntentId;
      clientSecret = intent.clientSecret;
      await this.orders.attachPaymentIntent(order.orderReference, paymentIntentId);
    }
    return {
      mode: 'stripe' as const,
      ...first,
      clientSecret,
      paymentIntentId,
      publishableKeyConfigured: this.payments.publishableKeyConfigured,
      ...base,
    };
  }

  // ---------------------------------------------------------------- expiry

  /** Expires every active cart past its hold window. Called by the unref'd timer. */
  async sweep(now = new Date()) {
    try {
      const due = await this.carts
        .find({ active: true, expiresAt: { $lte: now }, 'items.0': { $exists: true } })
        .limit(100)
        .exec();
      for (const cart of due) await this.expireCart(cart);
    } catch (error) {
      this.logger.warn(`Checkout sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  // --------------------------------------------------------------- private

  /** Active cart, lazily expired when its hold window ended. Null when none (or just expired). */
  private async loadActive(userId: string, now: Date): Promise<CartSessionDocument | null> {
    const cart = await this.carts.findOne({ userId: new Types.ObjectId(userId), active: true }).exec();
    if (!cart) return null;
    if (cart.items.length > 0 && cart.expiresAt.getTime() <= now.getTime()) {
      if (await this.expireCart(cart)) return null;
    }
    return cart;
  }

  private async loadOwned(userId: string, id: string): Promise<CartSessionDocument> {
    const cart = await this.carts.findOne({ _id: id, userId: new Types.ObjectId(userId) }).exec();
    if (!cart) throw new NotFoundException('Session not found');
    if (cart.active && cart.items.length > 0 && cart.expiresAt.getTime() <= Date.now()) {
      if (await this.expireCart(cart)) return (await this.carts.findById(cart._id).exec()) ?? cart;
    }
    return cart;
  }

  /** Active cart prepared for an edit: an unpaid awaiting_payment cart is reopened first. */
  private async loadForEdit(userId: string, now: Date) {
    const cart = await this.loadActive(userId, now);
    return cart ? this.reopen(cart) : null;
  }

  private async requireForEdit(userId: string, now: Date) {
    const cart = await this.loadForEdit(userId, now);
    if (!cart) throw appError(404, 'CART_EMPTY', 'Your cart is empty');
    return cart;
  }

  /** Editing an awaiting_payment cart cancels its unpaid order (and PaymentIntent) and reopens it. */
  private async reopen(cart: CartSessionDocument): Promise<CartSessionDocument> {
    if (cart.status !== 'awaiting_payment') return cart;
    const order = cart.orderReference ? await this.orders.findByReference(cart.orderReference) : null;
    if (order) {
      if (order.status === 'paid') throw appError(409, 'CART_LOCKED', 'This cart has already been paid');
      if (order.paymentIntentId && !this.payments.isMock) {
        const cancelled = await this.payments.cancelOrderIntent(order.paymentIntentId).catch(() => false);
        if (!cancelled) {
          throw appError(409, 'PAYMENT_IN_PROGRESS', 'A payment is being processed for this cart');
        }
      }
      const { released } = await this.orders.releaseOrder(order.orderReference, 'cancelled');
      if (!released) throw appError(409, 'CART_LOCKED', 'This cart can no longer be changed');
    }
    cart.status = 'open';
    cart.orderReference = undefined;
    await this.save(cart);
    return cart;
  }

  /** Marks a cart expired. False when it must stay (payment already succeeded or is in flight). */
  private async expireCart(cart: CartSessionDocument): Promise<boolean> {
    if (cart.status === 'awaiting_payment' && cart.orderReference) {
      const order = await this.orders.findByReference(cart.orderReference);
      if (order?.status === 'paid') return false;
      if (order?.status === 'pending_payment') {
        if (order.paymentIntentId && !this.payments.isMock) {
          const cancelled = await this.payments.cancelOrderIntent(order.paymentIntentId).catch(() => false);
          if (!cancelled) return false;
        }
        const { released } = await this.orders.releaseOrder(order.orderReference, 'expired');
        if (!released) return false;
      }
    }
    const result = await this.carts
      .updateOne(
        { _id: cart._id, active: true, status: cart.status },
        { $set: { status: 'expired', active: false, expiredNoticePending: true } },
      )
      .exec();
    if (result.modifiedCount) cart.status = 'expired';
    return true;
  }

  /**
   * The order and ALL of its bookings are created in one transaction: either the whole order exists or nothing does,
   * so a crash can never leave an order without (some of) its bookings. Inside the transaction the capacity locks
   * of every booked day are taken and capacity is checked again, so two customers racing for the last places cannot
   * both get them: the second one fails with DATE_UNAVAILABLE. Safe to repeat (it resumes an existing order).
   */
  private async ensureOrder(cart: CartSessionDocument, attempt = 0): Promise<NonNullable<Awaited<ReturnType<OrdersService['findByCart']>>>> {
    const cartId = cart._id.toString();
    const existing = await this.orders.findByCart(cartId);
    if (existing && existing.bookingReferences.length >= cart.items.length) return existing;

    const activityItems = cart.items.filter((item) => (item.productType ?? 'activity') === 'activity');
    const keys = activityItems.map((item) => ({ slug: item.activitySlug, optionId: item.optionId, day: item.date }));
    await this.capacity.ensureLocks(keys);
    const items = cart.items;
    const now = new Date();

    try {
      return await this.transactions.run(async (session) => {
        await this.capacity.lock(keys, session);
        // Re-read inside the transaction: a concurrent request for this cart may have just committed the order.
        let order = await this.orders.findByCart(cartId, session);
        if (order && order.bookingReferences.length >= items.length) return order;
        const orderReference = order?.orderReference ?? generateOrderReference();

        if (activityItems.length) await this.catalog.assertCapacity(
          activityItems.map((item) => ({ itemId: item.itemId, activitySlug: item.activitySlug, optionId: item.optionId, date: item.date, adults: item.adults, children: item.children })),
          { orderReference, session, now },
        );

        order ??= await this.orders.createOrder(
          {
            orderReference,
            userId: cart.userId,
            cartId: cart._id,
            status: 'pending_payment',
            active: true,
            subtotalMinor: cart.subtotalMinor,
            discountMinor: cart.discountMinor,
            taxMinor: cart.taxMinor,
            totalMinor: cart.totalMinor,
            currency: CURRENCY,
            promoCode: cart.promoCode,
            paymentMode: this.payments.isMock ? 'mock' : 'stripe',
          },
          session,
        );

        const references: string[] = [];
        for (const item of items) {
          // The tax rule that priced this line is frozen on the booking, so the invoice shows what the customer paid.
          const productType = item.productType ?? 'activity';
          const productSlug = item.productSlug ?? item.activitySlug;
          const det = (item.taxInfo as unknown as TaxDetermination | undefined) ?? (await this.tax.determineForProduct(productType, productSlug));
          const bookingInput = {
              orderReference: order.orderReference,
              cartItemId: item.itemId,
              customerId: cart.userId.toString(),
              title: item.activityTitle,
              image: item.image || undefined,
              location: item.locationName,
              optionId: item.optionId,
              optionName: item.optionName,
              transferType: item.transferType,
              startTime: item.startTime,
              serviceDay: item.date,
              adults: item.adults,
              children: item.children,
              adultUnitPrice: item.adultPrice.amount,
              pickupRequired: item.pickupRequired,
              pickup: item.pickup,
              additional: item.additional,
              customer: cart.customer!,
              priceLines: item.lines,
              subtotal: fromMinor(item.subtotalMinor),
              discount: fromMinor(item.discountMinor),
              tax: fromMinor(item.taxMinor),
              total: fromMinor(item.totalMinor),
              taxSnapshot: bookingTaxFields(det, item.totalMinor - item.taxMinor, item.taxMinor),
              promoCode: cart.promoCode,
              refundable: item.refundable,
              freeCancellationUntil: item.freeCancellationUntil,
              holdExpiresAt: cart.expiresAt,
            };
          const booking = productType === 'activity'
            ? await this.bookings.createActivityBooking({ ...bookingInput, activitySlug: item.activitySlug }, session)
            : await this.bookings.createPackageBooking({ ...bookingInput, productType, productSlug } as any, session);
          references.push(booking.reference);
        }
        await this.orders.attachBookings(order.orderReference, references, session);
        await this.carts.updateOne({ _id: cart._id }, { $set: { orderReference: order.orderReference } }, { session }).exec();
        order.bookingReferences = references;
        return order;
      });
    } catch (error) {
      // Lost a race on the one-order-per-cart index: the other request committed, so read its order instead.
      if ((error as { code?: number }).code === 11000 && attempt < 2) return this.ensureOrder(cart, attempt + 1);
      throw error;
    }
  }

  private async completedReplay(userId: string, now: Date) {
    const latest = await this.carts
      .findOne({ userId: new Types.ObjectId(userId), status: 'completed' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    if (!latest?.orderReference || now.getTime() - latest.updatedAt.getTime() > COMPLETED_REPLAY_MS) {
      return null;
    }
    const order = await this.orders.findByReference(latest.orderReference);
    if (!order) return null;
    return {
      mode: order.paymentMode === 'mock' ? ('mock' as const) : ('stripe' as const),
      status: 'succeeded' as const,
      bookingReference: order.bookingReferences[0],
      bookingReferences: order.bookingReferences,
      orderReference: order.orderReference,
      sessionId: latest._id.toString(),
    };
  }

  private async statusOf(cart: CartSessionDocument) {
    const bookings = cart.orderReference ? await this.bookings.statusesByOrder(cart.orderReference) : [];
    return {
      status: cart.status,
      sessionId: cart._id.toString(),
      ...(cart.orderReference && { orderReference: cart.orderReference }),
      ...(bookings[0] && { bookingReference: bookings[0].reference, bookingStatus: bookings[0].status }),
      ...(bookings.length > 0 && { bookings }),
    };
  }

  private sameKey(item: CartItem, dto: CartItemDto) {
    const type = dto.productType ?? 'activity';
    const slug = dto.productSlug ?? dto.activitySlug;
    return (
      (item.productType ?? 'activity') === type && (item.productSlug ?? item.activitySlug) === slug && item.optionId === dto.optionId && item.date === dto.date
    );
  }

  private prepare(dto: CartItemDto, itemId: string, now: Date, cartId?: string) {
    const type = dto.productType ?? 'activity';
    const slug = dto.productSlug ?? dto.activitySlug;
    if (!slug) throw appError(400, 'PRODUCT_REQUIRED', 'A package slug is required');
    const input = { itemId, optionId: dto.optionId, date: dto.date, adults: dto.adults, children: dto.children };
    return type === 'activity'
      ? this.catalog.prepareItem(slug, input, now, cartId, !dto.bookingOnly)
      : this.packages.prepare(type as PackageType, slug, input);
  }

  private buildItem(
    prepared: PreparedItem,
    dto: CartItemDto,
    itemId: string,
    previous?: CartItem,
  ): CartItem {
    const { option, activity } = prepared;
    const samePickupOption = previous?.optionId === option.id && option.pickupRequired;
    return {
      itemId,
      activitySlug: activity.slug,
      productType: dto.productType ?? 'activity',
      productSlug: dto.productSlug ?? activity.slug,
      bookingOnly: Boolean(dto.bookingOnly),
      activityTitle: activity.title,
      image: activity.image,
      ...(activity.locationName && { locationName: activity.locationName }),
      optionId: option.id,
      optionName: option.name,
      transferType: option.transferType,
      ...(option.startTime && { startTime: option.startTime }),
      pickupRequired: option.pickupRequired,
      refundable: option.refundable,
      ...(prepared.freeCancellationUntil && { freeCancellationUntil: prepared.freeCancellationUntil }),
      date: dto.date,
      adults: dto.adults,
      children: dto.children,
      lines: prepared.lines,
      adultPrice: option.adultPrice,
      childPrice: option.childPrice ?? null,
      subtotalMinor: prepared.subtotalMinor,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: prepared.subtotalMinor,
      ...(samePickupOption && previous?.pickup && { pickup: previous.pickup }),
      ...(previous?.additional && { additional: previous.additional }),
    };
  }

  /** Replaces the items, re-prices, restarts the shared hold window and saves. */
  private async commitItems(
    cart: CartSessionDocument,
    items: CartItem[],
    now: Date,
    display?: string,
  ) {
    await this.applyPricing(cart, items, now);
    cart.set('items', items);
    cart.expiresAt = holdExpiry(now, await this.holdMinutes());
    await this.save(cart);
    return this.sessionView(cart.toObject(), display);
  }

  /** Server-side pricing for the whole cart; drops a promo that no longer yields a discount. */
  private async applyPricing(
    cart: { promoCode?: string } & Partial<CartSession>,
    items: CartItem[],
    now: Date,
  ) {
    // Every line is taxed by the country where its service is delivered (see the tax module).
    const determinations = new Map<string, TaxDetermination>();
    for (const item of items) {
      const key = `${item.productType ?? 'activity'}:${item.productSlug ?? item.activitySlug}`;
      if (!determinations.has(key)) determinations.set(key, await this.tax.determineForProduct(item.productType ?? 'activity', item.productSlug ?? item.activitySlug));
    }
    const inputs = items.map((item) => {
      const key = `${item.productType ?? 'activity'}:${item.productSlug ?? item.activitySlug}`;
      const det = determinations.get(key)!;
      return { slug: item.productSlug ?? item.activitySlug, subtotalMinor: item.subtotalMinor, taxPercent: det.percent, taxInclusive: det.pricesIncludeTax };
    });
    let promo: PromoCode | null = null;
    if (cart.promoCode) {
      const found = await this.promos.findOne({ code: cart.promoCode }).lean().exec();
      if (found && !this.promoProblem(found, now)) promo = found;
    }
    const priced = priceCart(inputs, promo, 0);
    if (promo && priced.discountMinor === 0) promo = null;
    const final = promo ? priced : priceCart(inputs, null, 0);
    items.forEach((item, i) => {
      item.discountMinor = final.items[i].discountMinor;
      item.taxMinor = final.items[i].taxMinor;
      item.totalMinor = final.items[i].totalMinor;
      item.taxInfo = determinations.get(`${item.productType ?? 'activity'}:${item.productSlug ?? item.activitySlug}`) as unknown as Record<string, unknown>;
    });
    cart.promoCode = promo?.code;
    cart.subtotalMinor = final.subtotalMinor;
    cart.discountMinor = final.discountMinor;
    cart.taxMinor = final.taxMinor;
    cart.totalMinor = final.totalMinor;
  }

  private promoProblem(promo: PromoCode, now: Date) {
    if (promo.isSample && !this.sampleVisible) return 'sample';
    return promoRejection(promo, now);
  }

  private async save(cart: CartSessionDocument) {
    try {
      await cart.save();
    } catch (error) {
      const err = error as { name?: string; code?: number };
      if (err.name === 'VersionError' || err.code === 11000) {
        throw appError(409, 'CART_CONFLICT', 'Your cart was changed elsewhere; reload it and try again');
      }
      throw error;
    }
  }

  private steps(items: CartItem[], customer: unknown) {
    return {
      cart: items.length > 0,
      pickup: items.length > 0 && items.every((i) => !i.pickupRequired || !!i.pickup),
      additional: items.length > 0 && items.every((i) => !!i.additional),
      customer: !!customer,
    };
  }

  // ----------------------------------------------------------------- views

  private itemView(item: CartItem) {
    return {
      id: item.itemId,
      activity: {
        slug: item.activitySlug,
        title: item.activityTitle,
        image: item.image,
        ...(item.locationName && { location: item.locationName }),
      },
      productType: item.productType ?? 'activity',
      productSlug: item.productSlug ?? item.activitySlug,
      option: {
        id: item.optionId,
        name: item.optionName,
        transferType: item.transferType,
        ...(item.startTime && { startTime: item.startTime }),
        pickupRequired: item.pickupRequired,
        refundable: item.refundable,
        ...(item.freeCancellationUntil && {
          freeCancellationUntil: new Date(item.freeCancellationUntil).toISOString(),
        }),
      },
      date: item.date,
      adults: item.adults,
      children: item.children,
      pricing: {
        lines: item.lines,
        subtotal: moneyOf(item.subtotalMinor),
        discount: moneyOf(item.discountMinor),
        taxesAndFees: moneyOf(item.taxMinor),
        total: moneyOf(item.totalMinor),
        currency: CURRENCY,
      },
      ...(item.pickup && { pickup: item.pickup }),
      ...(item.additional && { additional: item.additional }),
    };
  }

  private pricingView(
    totals: { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number },
    promoCode?: string,
    display?: string,
  ) {
    const indicative = indicativeDisplay(
      fromMinor(totals.totalMinor),
      display,
      this.currency.rates,
      this.currency.markupPercent,
    );
    return {
      subtotal: moneyOf(totals.subtotalMinor),
      discount: moneyOf(totals.discountMinor),
      taxesAndFees: moneyOf(totals.taxMinor),
      total: moneyOf(totals.totalMinor),
      currency: CURRENCY,
      ...(promoCode && { promoCode }),
      ...(indicative && { display: { currency: indicative.currency, total: indicative.total } }),
    };
  }

  private async sessionView(cart: PlainCart, display?: string) {
    // While the cart is open each line is re-checked against live stock; once it is paying, its own order holds the places.
    const now = new Date();
    const checks =
      cart.status === 'open'
        ? await Promise.all(
            cart.items.map((item) => (item.productType ?? 'activity') === 'activity'
              ? this.catalog.lineAvailability(item.activitySlug, item, now, cart._id.toString())
              : this.packages.available(item.productType as PackageType, item.productSlug ?? item.activitySlug, item)),
          )
        : [];
    return {
      id: cart._id.toString(),
      status: cart.status,
      expiresAt: cart.expiresAt.toISOString(),
      items: cart.items.map((item, index) => ({ ...this.itemView(item), available: checks[index]?.available ?? true, ...(checks[index]?.remaining !== undefined && { remaining: checks[index].remaining }) })),
      pricing: this.pricingView(cart, cart.promoCode, display),
      ...(cart.customer && { customer: cart.customer }),
      ...(cart.orderReference && { orderReference: cart.orderReference }),
      steps: this.steps(cart.items, cart.customer),
    };
  }

  private emptyView(expired?: CartItem[], display?: string) {
    const zero = { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 };
    return {
      id: null,
      status: 'open' as const,
      expiresAt: null,
      items: [] as ReturnType<CheckoutService['itemView']>[],
      pricing: this.pricingView(zero, undefined, display),
      steps: this.steps([], undefined),
      ...(expired?.length && { expired: expired.map((item) => this.itemView(item)) }),
    };
  }
}
