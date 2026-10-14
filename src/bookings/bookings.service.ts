import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { BillingService } from '../crm/billing/billing.service';
import { InventoryService } from '../crm/inventory/inventory.service';
import { SettingsService } from '../admin/settings/settings.service';
import { VouchersService } from '../vouchers/vouchers.service';
import type { BookingTaxFields } from '../tax/tax-snapshot';
import { ServiceType } from '../common/enums/service-type.enum';
import { BookingCostService } from './booking-cost';
import { CreateBookingDto } from './dto/create-booking.dto';
import {
  AdditionalDetails,
  CustomerDetails,
  PickupDetails,
  PriceLineDoc,
} from './schemas/booking-parts.schema';
import { Booking, BookingStatus } from './schemas/booking.schema';

export const CANCELLATION_MESSAGE =
  'Your cancellation request has been received. Our team reviews every request and handles refunds manually; ' +
  'bookings cancelled before the free-cancellation deadline are eligible for a refund to the original payment method.';

/** Everything an activity booking snapshots from a cart item at payment time. */
export interface ActivityBookingInput {
  orderReference: string;
  cartItemId: string;
  customerId: string;
  partnerId?: string;
  activitySlug: string;
  title: string;
  image?: string;
  location?: string;
  optionId: string;
  optionName: string;
  transferType: string;
  startTime?: string;
  serviceDay: string;
  adults: number;
  children: number;
  adultUnitPrice: number;
  pickupRequired: boolean;
  pickup?: PickupDetails;
  additional?: AdditionalDetails;
  customer: CustomerDetails;
  priceLines: PriceLineDoc[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  promoCode?: string;
  refundable: boolean;
  freeCancellationUntil?: Date;
  holdExpiresAt: Date;
  /** The tax rule that priced the cart item, frozen on the booking. */
  taxSnapshot?: BookingTaxFields;
}

export interface PackageBookingInput extends Omit<ActivityBookingInput, 'activitySlug'> {
  productType: 'holiday' | 'cruise' | 'event';
  productSlug: string;
}

/** A confirmed booking created by staff from a holiday, cruise or event enquiry (offline payment). */
export interface EnquiryBookingInput {
  customerId: string;
  source: 'holiday' | 'cruise' | 'event';
  productRef: string;
  variantId: string;
  title: string;
  /** Shown as the option name on the invoice; omitted for the `default` variant. */
  optionName?: string;
  serviceDay: string;
  quantity: number;
  adults?: number;
  children?: number;
  total: number;
  currency: string;
  paymentReference: string;
  customer: CustomerDetails;
  actor: { id: string; name: string };
  eventText: string;
  note?: string;
  /** Tax-exclusive amount, tax and snapshot when the total staff entered is split into net + tax. Without it the total is untaxed. */
  net?: number;
  taxAmount?: number;
  taxSnapshot?: BookingTaxFields;
  taxOverride?: Booking['taxOverride'];
  invoiceBuyer?: Booking['invoiceBuyer'];
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly inventory: InventoryService,
    private readonly billing: BillingService,
    private readonly vouchers: VouchersService,
    private readonly settings: SettingsService,
    private readonly costs: BookingCostService,
  ) {}

  async create(dto: CreateBookingDto, user: AuthenticatedUser) {
    const stock = await this.inventory.findBySku(dto.sku);
    await this.inventory.reserve(dto.sku, dto.quantity);
    try {
      const subtotal = this.money(stock.retailPrice * dto.quantity);
      const isPartner = user.roles.some((role) =>
        [Role.B2BOwner, Role.B2BManager, Role.B2BAgent].includes(role as Role),
      );
      const partnerDiscount = isPartner ? this.money(subtotal * 0.1) : 0;
      const tax = 0;
      const total = this.money(subtotal - partnerDiscount + tax);
      const freeCancellationUntil = stock.serviceDate
        ? new Date(stock.serviceDate.getTime() - 48 * 60 * 60 * 1000)
        : undefined;
      return await this.bookings.create({
        reference: `TVX-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,
        customerId: new Types.ObjectId(user.sub),
        partnerId: user.partnerId ? new Types.ObjectId(user.partnerId) : undefined,
        sku: stock.sku,
        serviceType: stock.serviceType,
        title: stock.title,
        quantity: dto.quantity,
        unitPrice: stock.retailPrice,
        subtotal,
        partnerDiscount,
        tax,
        total,
        currency: stock.currency,
        serviceDate: stock.serviceDate,
        refundable: true,
        freeCancellationUntil,
        status: BookingStatus.PendingPayment,
      });
    } catch (error) {
      await this.inventory.release(dto.sku, dto.quantity);
      throw error;
    }
  }

  /** The caller's own bookings only. Staff use GET /admin/bookings (permission checked, audited exports). */
  async listForUser(user: AuthenticatedUser) {
    return this.bookings
      .find({ customerId: new Types.ObjectId(user.sub) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /**  is a Mongo id or the booking reference (e.g. TVX-2026-1A2B3C4D). Owner only. */
  async findAccessible(id: string, user: AuthenticatedUser) {
    const isObjectId = /^[a-f0-9]{24}$/i.test(id);
    const booking = await (isObjectId
      ? this.bookings.findById(id)
      : this.bookings.findOne({ reference: id })
    ).exec();
    if (!booking || booking.customerId.toString() !== user.sub) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  /** All bookings of one order (the caller's own). */
  async listByOrder(orderReference: string, user: AuthenticatedUser) {
    const bookings = await this.bookings
      .find({ orderReference, customerId: new Types.ObjectId(user.sub) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    if (!bookings.length) throw new NotFoundException('Order not found');
    return {
      orderReference,
      currency: bookings[0].currency,
      total: this.money(bookings.reduce((sum, b) => sum + b.total, 0)),
      status: bookings.every((b) => b.status === BookingStatus.Confirmed)
        ? 'confirmed'
        : bookings[0].status,
      bookings,
    };
  }

  /**
   * One Booking per cart item, idempotent per (order, cart item): retries after a crash or a
   * concurrent pay return the existing booking instead of creating a second one.
   */
  async createActivityBooking(input: ActivityBookingInput, session?: ClientSession) {
    const key = { orderReference: input.orderReference, cartItemId: input.cartItemId };
    const document = {
      reference: `TVX-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,
      customerId: new Types.ObjectId(input.customerId),
      partnerId: input.partnerId ? new Types.ObjectId(input.partnerId) : undefined,
      serviceType: ServiceType.Activity,
      title: input.title,
      activitySlug: input.activitySlug,
      stockProductType: 'activity',
      stockProductRef: input.activitySlug,
      stockVariantId: input.optionId,
      activityImage: input.image,
      activityLocation: input.location,
      optionId: input.optionId,
      optionName: input.optionName,
      transferType: input.transferType,
      startTime: input.startTime,
      serviceDay: input.serviceDay,
      serviceDate: new Date(`${input.serviceDay}T00:00:00.000Z`),
      adults: input.adults,
      children: input.children,
      quantity: input.adults + input.children,
      unitPrice: input.adultUnitPrice,
      pickupRequired: input.pickupRequired,
      pickup: input.pickup,
      additional: input.additional,
      customer: input.customer,
      priceLines: input.priceLines,
      subtotal: input.subtotal,
      discount: input.discount,
      tax: input.tax,
      total: input.total,
      promoCode: input.promoCode,
      currency: 'AED',
      refundable: input.refundable,
      freeCancellationUntil: input.freeCancellationUntil,
      cancellationPolicy: input.refundable
        ? 'Free cancellation until the deadline shown on the voucher; after that the booking is non-refundable.'
        : 'Non-refundable.',
      status: BookingStatus.PendingPayment,
      holdExpiresAt: input.holdExpiresAt,
      ...input.taxSnapshot,
    };
    try {
      return await this.bookings
        .findOneAndUpdate(
          key,
          { $setOnInsert: Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined)) },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session },
        )
        .exec();
    } catch (error) {
      // Inside a transaction a duplicate key aborts it: let the caller's transaction retry instead of reading on.
      if (session || (error as { code?: number }).code !== 11000) throw error;
      const existing = await this.bookings.findOne(key).exec();
      if (!existing) throw error;
      return existing;
    }
  }

  /** Creates a paid-checkout booking for a non-activity catalogue package. */
  async createPackageBooking(input: PackageBookingInput, session?: ClientSession) {
    const key = { orderReference: input.orderReference, cartItemId: input.cartItemId };
    const document = {
      reference: `TVX-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,
      customerId: new Types.ObjectId(input.customerId),
      serviceType: input.productType,
      title: input.title,
      stockProductType: input.productType,
      stockProductRef: input.productSlug,
      stockVariantId: input.optionId,
      activityImage: input.image,
      activityLocation: input.location,
      optionId: input.optionId,
      optionName: input.optionName,
      serviceDay: input.serviceDay,
      serviceDate: new Date(`${input.serviceDay}T00:00:00.000Z`),
      adults: input.adults,
      children: input.children,
      quantity: input.adults + input.children,
      unitPrice: input.adultUnitPrice,
      pickupRequired: false,
      additional: input.additional,
      customer: input.customer,
      priceLines: input.priceLines,
      subtotal: input.subtotal,
      discount: input.discount,
      tax: input.tax,
      total: input.total,
      promoCode: input.promoCode,
      currency: 'AED',
      refundable: input.refundable,
      cancellationPolicy: input.refundable ? 'Refundability is subject to the package terms.' : 'Non-refundable.',
      status: BookingStatus.PendingPayment,
      holdExpiresAt: input.holdExpiresAt,
      ...input.taxSnapshot,
    };
    return this.bookings.findOneAndUpdate(
      key,
      { $setOnInsert: Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined)) },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session },
    ).exec();
  }

  /**
   * Creates a CONFIRMED booking for an enquiry that staff turned into a sale. Meant to run inside the caller's
   * transaction (after taking the stock lock); the invoice and voucher follow after the commit via `afterConfirmed`.
   */
  async createEnquiryBooking(input: EnquiryBookingInput, session: ClientSession): Promise<Booking & { _id: Types.ObjectId }> {
    const now = new Date();
    const [created] = await this.bookings.create(
      [
        {
          reference: `TVX-${now.getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,
          customerId: new Types.ObjectId(input.customerId),
          serviceType: input.source,
          title: input.title,
          ...(input.optionName && { optionName: input.optionName }),
          serviceDay: input.serviceDay,
          serviceDate: new Date(`${input.serviceDay}T00:00:00.000Z`),
          quantity: input.quantity,
          ...(input.adults !== undefined && { adults: input.adults }),
          ...(input.children !== undefined && { children: input.children }),
          unitPrice: Math.round(((input.net ?? input.total) / input.quantity + Number.EPSILON) * 100) / 100,
          subtotal: input.net ?? input.total,
          discount: 0,
          tax: input.taxAmount ?? 0,
          total: input.total,
          ...input.taxSnapshot,
          ...(input.taxOverride && { taxOverride: input.taxOverride }),
          ...(input.invoiceBuyer && { invoiceBuyer: input.invoiceBuyer }),
          currency: input.currency,
          refundable: false,
          cancellationPolicy: 'Arranged with our team; contact us to change or cancel this booking.',
          status: BookingStatus.Confirmed,
          paymentReference: input.paymentReference,
          confirmedAt: now,
          customer: input.customer,
          stockProductType: input.source,
          stockProductRef: input.productRef,
          stockVariantId: input.variantId,
          events: [
            {
              type: 'confirmed_manually',
              at: now,
              actorId: new Types.ObjectId(input.actor.id),
              actorName: input.actor.name,
              text: input.eventText.slice(0, 500),
            },
          ],
          ...(input.note && {
            notes: [{ id: randomBytes(8).toString('hex'), at: now, authorId: new Types.ObjectId(input.actor.id), authorName: input.actor.name, text: input.note }],
          }),
        },
      ],
      { session },
    );
    const booking = created.toObject();
    await this.costs.snapshot([booking], session);
    return booking;
  }

  /** Reference + status of each booking in an order (for the post-payment status poll). */
  async statusesByOrder(orderReference: string) {
    const rows = await this.bookings
      .find({ orderReference })
      .sort({ createdAt: 1 })
      .select('reference status')
      .lean()
      .exec();
    return rows.map((row) => ({ reference: row.reference, status: row.status }));
  }

  /** Confirms every booking of a paid order. Safe to repeat. */
  async confirmOrderPayment(orderReference: string, paymentReference: string) {
    const bookings = await this.bookings.find({ orderReference }).select('_id').lean().exec();
    const confirmed = [];
    for (const { _id } of bookings) {
      confirmed.push(await this.confirmPayment(_id.toString(), paymentReference));
    }
    return confirmed;
  }

  /**
   * Database half of confirming a paid order, for use inside the order transaction: flips every pending_payment
   * booking of the order to confirmed. Bookings that are already confirmed are returned as settled (a repeat of a
   * webhook); any other status is skipped and logged, because the money was taken and staff must review it.
   * Invoices, vouchers, inventory and notices are NOT touched here: they run after the commit in `finalizeConfirmed`.
   */
  async confirmOrderBookings(orderReference: string, paymentReference: string, session: ClientSession) {
    const rows = await this.bookings.find({ orderReference }).session(session).lean().exec();
    const flipped: Array<Booking & { _id: Types.ObjectId }> = [];
    const settled: Array<Booking & { _id: Types.ObjectId }> = [];
    for (const row of rows) {
      if (row.status === BookingStatus.Confirmed) {
        settled.push(row);
      } else if (row.status === BookingStatus.PendingPayment) {
        const updated = await this.bookings
          .findOneAndUpdate(
            { _id: row._id, status: BookingStatus.PendingPayment },
            { $set: { status: BookingStatus.Confirmed, paymentReference, confirmedAt: new Date() }, $unset: { holdExpiresAt: 1 } },
            { returnDocument: 'after', session },
          )
          .lean()
          .exec();
        if (updated) flipped.push(updated);
      } else {
        this.logger.error(`Booking ${row.reference} is ${row.status} but order ${orderReference} was paid; needs manual review/refund`);
      }
    }
    await this.costs.snapshot(flipped, session);
    return { flipped, settled };
  }

  /**
   * Runs after the order transaction committed: inventory for the bookings that just flipped, then the idempotent
   * invoice and voucher for every confirmed booking (a failure is logged and retried by the reconciliation sweep).
   */
  async finalizeConfirmed(flipped: Array<Booking & { _id: Types.ObjectId }>, settled: Array<Booking & { _id: Types.ObjectId }>) {
    for (const booking of flipped) {
      // Activity bookings have no inventory SKU: their capacity is counted from bookings and holds.
      if (booking.sku) await this.inventory.confirm(booking.sku, booking.quantity);
    }
    for (const booking of [...flipped, ...settled]) await this.afterConfirmed(booking);
  }

  /** True while a paid order still has a booking waiting to be confirmed, or a confirmed one without its voucher. */
  async needsFinalizing(orderReference: string): Promise<boolean> {
    const rows = await this.bookings.find({ orderReference }).select('_id status').lean().exec();
    if (rows.some((row) => row.status === BookingStatus.PendingPayment)) return true;
    for (const row of rows) {
      if (row.status === BookingStatus.Confirmed && !(await this.vouchers.findByBooking(row._id))) return true;
    }
    return false;
  }

  /** Releases the capacity held by an order's unpaid bookings. */
  async expireOrderBookings(orderReference: string) {
    await this.bookings
      .updateMany(
        { orderReference, status: BookingStatus.PendingPayment },
        { $set: { status: BookingStatus.Expired }, $unset: { holdExpiresAt: 1 } },
      )
      .exec();
  }

  /**
   * Marks a booking paid and confirmed. Idempotent and race-safe: only one caller flips
   * pending_payment to confirmed; every caller then makes sure the invoice and the voucher exist
   * (both are idempotent and never fail the confirmation). `actor` is set when staff confirm manually.
   */
  async confirmPayment(
    bookingId: string,
    paymentReference: string,
    actor?: { id: string; name: string },
  ): Promise<Booking> {
    const booking = await this.bookings.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.Confirmed) {
      if (booking.status !== BookingStatus.PendingPayment) {
        throw new BadRequestException('Booking cannot be confirmed from its current status');
      }
      const flipped = await this.bookings
        .findOneAndUpdate(
          { _id: booking._id, status: BookingStatus.PendingPayment },
          {
            $set: { status: BookingStatus.Confirmed, paymentReference, confirmedAt: new Date() },
            $unset: { holdExpiresAt: 1 },
            ...(actor && {
              $push: {
                events: {
                  type: 'confirmed_manually',
                  at: new Date(),
                  actorId: new Types.ObjectId(actor.id),
                  actorName: actor.name,
                  text: `Payment reference ${paymentReference}`.slice(0, 500),
                },
              },
            }),
          },
          { returnDocument: 'after' },
        )
        .exec();
      if (!flipped) return this.confirmPayment(bookingId, paymentReference, actor); // lost the race
      // Activity bookings have no inventory SKU: their capacity is counted from bookings and holds.
      if (flipped.sku) await this.inventory.confirm(flipped.sku, flipped.quantity);
      await this.costs.snapshot([flipped]).catch((error) => this.logger.error(`Cost snapshot failed for ${flipped.reference}: ${error}`));
      await this.afterConfirmed(flipped);
      return flipped;
    }
    await this.afterConfirmed(booking);
    return booking;
  }

  /** Invoice + voucher for a confirmed booking; both idempotent, failures are logged, never thrown. */
  async afterConfirmed(booking: Booking & { _id: Types.ObjectId }) {
    try {
      const { taxPercent } = await this.settings.getCommerce();
      await this.billing.createForBooking(booking, taxPercent);
    } catch (error) {
      this.logger.error(`Invoice for ${booking.reference} failed: ${(error as Error).message}`);
    }
    await this.vouchers.issueForBooking(booking);
  }

  /** E-mails invoices / credit notes whose first send failed (backoff, max 5 attempts). Runs with the reconciliation sweep; never throws. */
  retryInvoiceEmails(): Promise<number> {
    return this.billing.retryEmails();
  }

  /** The caller's own voucher (QR) for a confirmed booking, or null while none is issued. */
  async voucherFor(id: string, user: AuthenticatedUser) {
    const booking = await this.findAccessible(id, user);
    const voucher = await this.vouchers.findByBooking(booking._id);
    if (!voucher) return null;
    const { code, displayCode, url, qr, status, redeemedAt } = this.vouchers.toView(voucher);
    return { code, displayCode, url, qr, status, redeemedAt };
  }

  /** PDF invoice of the caller's own booking; created on first request when the booking was confirmed before invoices existed. */
  async invoicePdfFor(id: string, user: AuthenticatedUser) {
    const booking = await this.findAccessible(id, user);
    if (!booking.confirmedAt) throw new NotFoundException('No invoice for this booking yet');
    let invoice = await this.billing.findInvoiceForBooking(booking._id);
    if (!invoice) {
      const { taxPercent } = await this.settings.getCommerce();
      invoice = (await this.billing.createForBooking(booking, taxPercent)).toObject();
    }
    return { filename: invoice.invoiceNumber + '.pdf', buffer: await this.billing.pdfFor(invoice) };
  }

  async requestCancellation(id: string, user: AuthenticatedUser) {
    const booking = await this.findAccessible(id, user);
    if (booking.status !== BookingStatus.Confirmed) {
      throw new BadRequestException('Only confirmed bookings can be cancelled');
    }
    const refundable = Boolean(
      booking.refundable &&
        booking.freeCancellationUntil &&
        new Date() <= booking.freeCancellationUntil,
    );
    const now = new Date();
    const updated = await this.bookings
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.Confirmed },
        {
          $set: { status: BookingStatus.CancellationRequested, cancellationRequestedAt: now },
          $push: {
            events: {
              type: 'cancellation_requested',
              at: now,
              actorId: new Types.ObjectId(user.sub),
              actorName: booking.customer?.fullName ?? user.email,
            },
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) throw new BadRequestException('Only confirmed bookings can be cancelled');
    booking.status = updated.status;
    return {
      message: CANCELLATION_MESSAGE,
      booking,
      refund: {
        eligible: refundable,
        amount: refundable ? booking.total : 0,
        currency: booking.currency,
        policy: booking.cancellationPolicy,
        status: refundable ? 'pending_finance_approval' : 'not_eligible',
      },
    };
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
