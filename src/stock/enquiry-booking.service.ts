import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import { listItem } from '../admin-bookings/booking-view';
import { BookingsService } from '../bookings/bookings.service';
import { isValidIsoDate, operatingToday } from '../catalog/activity-booking.utils';
import { appError, appErrorWith } from '../common/app-error';
import { TransactionService } from '../common/database/transaction.service';
import { Role } from '../common/enums/role.enum';
import { BillingService } from '../crm/billing/billing.service';
import { CruiseEnquiry } from '../cruises/schemas/cruise-enquiry.schema';
import { EventEnquiry } from '../events/schemas/event-enquiry.schema';
import { HolidayEnquiry } from '../holidays/schemas/holiday-enquiry.schema';
import { Lead } from '../leads/lead.schema';
import { LeadsService } from '../leads/leads.service';
import { NotificationsService } from '../notifications/notifications.service';
import { bookingTaxFields } from '../tax/tax-snapshot';
import { TaxRuleError, fromMinor, inclusiveBreakdown, toMinor } from '../tax/tax.rules';
import { TaxService } from '../tax/tax.service';
import { User, UserStatus } from '../users/schemas/user.schema';
import { EnquiryBookingDto } from './dto/stock.dto';
import { StockService } from './stock.service';
import type { EnquirySource } from './stock.types';

/** The fields of a holiday / cruise / event enquiry this flow needs, whatever the collection. */
interface EnquiryFacts {
  _id: Types.ObjectId;
  reference: string;
  slug: string;
  fullName: string;
  email: string;
  phone: string;
  nationality?: string;
  userId?: Types.ObjectId;
  status: string;
  bookingReference?: string;
}

/**
 * Staff press "Confirm booking" on a holiday, cruise or event enquiry: ONE transaction takes the stock lock,
 * re-checks availability, creates a confirmed booking and marks the enquiry `booked`. The invoice and voucher follow
 * after the commit through the same idempotent path as online payments.
 */
@Injectable()
export class EnquiryBookingService {
  private readonly logger = new Logger(EnquiryBookingService.name);

  constructor(
    @InjectModel(HolidayEnquiry.name) private readonly holidayEnquiries: Model<HolidayEnquiry>,
    @InjectModel(CruiseEnquiry.name) private readonly cruiseEnquiries: Model<CruiseEnquiry>,
    @InjectModel(EventEnquiry.name) private readonly eventEnquiries: Model<EventEnquiry>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Lead.name) private readonly leadDocs: Model<Lead>,
    private readonly stock: StockService,
    private readonly bookings: BookingsService,
    private readonly billing: BillingService,
    private readonly leads: LeadsService,
    private readonly notifications: NotificationsService,
    private readonly transactions: TransactionService,
    private readonly tax: TaxService,
  ) {}

  private model(source: EnquirySource): Model<any> {
    return source === 'holiday' ? this.holidayEnquiries : source === 'cruise' ? this.cruiseEnquiries : this.eventEnquiries;
  }

  private async loadEnquiry(source: EnquirySource, id: string, session?: ClientSession): Promise<EnquiryFacts> {
    const doc = await this.model(source).findById(id).session(session ?? null).lean().exec();
    if (!doc) throw appError(404, 'ENQUIRY_NOT_FOUND', 'Enquiry not found');
    return {
      _id: doc._id,
      reference: doc.reference,
      slug: doc.holidaySlug ?? doc.cruiseSlug ?? doc.eventSlug,
      fullName: doc.fullName,
      email: doc.email,
      phone: doc.phone,
      nationality: doc.nationality,
      userId: doc.userId,
      status: doc.status,
      bookingReference: doc.bookingReference,
    };
  }

  private alreadyBooked(enquiry: EnquiryFacts) {
    return appErrorWith(409, 'ENQUIRY_ALREADY_BOOKED', 'This enquiry was already confirmed into a booking', {
      bookingReference: enquiry.bookingReference ?? null,
    });
  }

  /** The customer the booking belongs to: the enquirer's account, an existing account with that e-mail, or a new one. */
  private async ensureCustomer(enquiry: EnquiryFacts): Promise<string> {
    if (enquiry.userId) {
      const known = await this.users.exists({ _id: enquiry.userId }).exec();
      if (known) return enquiry.userId.toString();
    }
    const email = enquiry.email.trim().toLowerCase();
    const existing = await this.users.findOne({ email }).select('_id').lean().exec();
    if (existing) return existing._id.toString();
    const [firstName, ...rest] = enquiry.fullName.trim().split(/\s+/);
    try {
      const created = await this.users.create({
        firstName: firstName || email.split('@')[0],
        lastName: rest.join(' '),
        email,
        roles: [Role.Customer],
        status: UserStatus.Active,
      });
      return created._id.toString();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const raced = await this.users.findOne({ email }).select('_id').lean().exec();
      if (!raced) throw error;
      return raced._id.toString();
    }
  }

  /** The admin leads view only knows the lead: accept the lead id and resolve the enquiry behind it. */
  private async resolveEnquiryId(source: EnquirySource, id: string): Promise<string> {
    if (await this.model(source).exists({ _id: id }).exec()) return id;
    const lead = await this.leadDocs.findOne({ _id: id, source }).select('sourceId sourceRef').lean<Lead>().exec();
    if (lead?.sourceId && (await this.model(source).exists({ _id: lead.sourceId }).exec())) return lead.sourceId.toString();
    if (lead) {
      const byRef = await this.model(source).findOne({ reference: lead.sourceRef }).select('_id').lean<{ _id: Types.ObjectId }>().exec();
      if (byRef) return byRef._id.toString();
    }
    throw appError(404, 'ENQUIRY_NOT_FOUND', 'Enquiry not found');
  }

  async confirm(input: EnquiryBookingDto, actor: { id: string; email: string }, now = new Date()) {
    const dto = { ...input, enquiryId: await this.resolveEnquiryId(input.source, input.enquiryId) };
    const enquiry = await this.loadEnquiry(dto.source, dto.enquiryId);
    if (enquiry.bookingReference || enquiry.status === 'booked') throw this.alreadyBooked(enquiry);

    if (!isValidIsoDate(dto.serviceDay)) throw appError(400, 'INVALID_DATE', 'serviceDay must be a valid YYYY-MM-DD date');
    if (dto.serviceDay < operatingToday(now)) throw appError(400, 'INVALID_DATE', 'serviceDay cannot be in the past');
    if (dto.adults !== undefined && dto.children !== undefined && dto.adults + dto.children !== dto.quantity) {
      throw appError(400, 'PAX_MISMATCH', 'adults + children must equal quantity');
    }

    const key = { productType: dto.source, productRef: enquiry.slug, variantId: dto.variantId } as const;
    const variant = await this.stock.loadVariant(key);
    if (!variant) throw appError(404, 'ITEM_NOT_FOUND', 'This product has no such variant (cabin type, ticket type or default)');
    if (!variant.operational(dto.serviceDay, now)) {
      throw appError(409, 'DATE_UNAVAILABLE', 'This product does not run on the selected date');
    }

    // The total staff entered is what the customer pays (tax inclusive): the tax is extracted from it, never added on top.
    const override = dto.tax && Object.values(dto.tax).some(Boolean) ? { ...dto.tax, placeOfSupplyState: dto.tax.placeOfSupplyState, placeOfSupplyStateCode: dto.tax.placeOfSupplyStateCode } : undefined;
    let determination;
    try {
      determination = await this.tax.determine({
        serviceCountry: await this.tax.countryForProduct(dto.source, enquiry.slug),
        customerState: dto.buyer?.state,
        customerStateCode: dto.buyer?.stateCode,
        override,
      });
    } catch (error) {
      if (error instanceof TaxRuleError) throw appError(400, error.code, error.message);
      throw error;
    }
    const taxDetermination = { ...determination, pricesIncludeTax: true };
    const breakdown = inclusiveBreakdown(toMinor(dto.totalAmount), taxDetermination);
    const buyerGiven = dto.buyer && Object.values(dto.buyer).some(Boolean) ? dto.buyer : undefined;

    const customerId = await this.ensureCustomer(enquiry);
    await this.stock.ensureLocks([{ ...key, day: dto.serviceDay }]);

    const booking = await this.transactions.run(async (session) => {
      await this.stock.lock([{ ...key, day: dto.serviceDay }], session);
      // Read again inside the transaction: another request may have booked this enquiry or the last units a moment ago.
      const fresh = await this.loadEnquiry(dto.source, dto.enquiryId, session);
      if (fresh.bookingReference || fresh.status === 'booked') throw this.alreadyBooked(fresh);

      const info = (await this.stock.capacityInfo(key, variant.legacyCapacity, dto.serviceDay, dto.serviceDay, now, { session })).get(dto.serviceDay)!;
      const available = info.closed ? 0 : info.limit === null ? null : Math.max(0, info.limit - info.booked);
      if (available !== null && available < dto.quantity) {
        throw appErrorWith(
          409,
          'STOCK_UNAVAILABLE',
          available === 0 ? 'Sold out for that date' : `Only ${available} left for that date`,
          { available },
        );
      }

      const created = await this.bookings.createEnquiryBooking(
        {
          customerId,
          source: dto.source,
          productRef: enquiry.slug,
          variantId: dto.variantId,
          title: variant.title,
          ...(dto.variantId !== 'default' && { optionName: variant.variantLabel || dto.variantId }),
          serviceDay: dto.serviceDay,
          quantity: dto.quantity,
          adults: dto.adults,
          children: dto.children,
          total: dto.totalAmount,
          currency: dto.currency,
          paymentReference: dto.paymentReference || `offline_${dto.paymentMode}`,
          customer: {
            fullName: fresh.fullName,
            email: fresh.email.trim().toLowerCase(),
            phoneCountryCode: 'n/a',
            phone: fresh.phone,
            nationality: fresh.nationality || 'Not provided',
            marketingOptOut: false,
          },
          actor: { id: actor.id, name: actor.email },
          eventText: `Enquiry ${fresh.reference} confirmed. Payment: ${dto.paymentMode}${dto.paymentReference ? ` (${dto.paymentReference})` : ''}`,
          note: dto.note,
          net: fromMinor(breakdown.netMinor),
          taxAmount: fromMinor(breakdown.taxMinor),
          taxSnapshot: bookingTaxFields(taxDetermination, breakdown.netMinor, breakdown.taxMinor),
          ...(override || buyerGiven?.registrationNumber
            ? {
                taxOverride: {
                  ...(override?.country && { country: override.country }),
                  ...(override?.rateCode && { rateCode: override.rateCode }),
                  ...(override?.placeOfSupplyState && { placeOfSupplyState: override.placeOfSupplyState }),
                  ...(override?.placeOfSupplyStateCode && { placeOfSupplyStateCode: override.placeOfSupplyStateCode }),
                  ...(buyerGiven?.registrationNumber && { buyerRegistrationNumber: buyerGiven.registrationNumber }),
                  reason: 'Chosen by staff when confirming the enquiry',
                  by: actor.email,
                  at: now,
                },
              }
            : {}),
          ...(buyerGiven && { invoiceBuyer: buyerGiven }),
        },
        session,
      );

      const marked = await this.model(dto.source)
        .updateOne(
          { _id: fresh._id, bookingReference: { $exists: false }, status: { $ne: 'booked' } },
          { $set: { status: 'booked', bookingReference: created.reference, bookedAt: now } },
          { session },
        )
        .exec();
      if (marked.modifiedCount === 0) throw this.alreadyBooked(fresh);
      return created;
    });

    // After the commit: invoice + voucher (idempotent, failures are logged and retried by the reconciliation paths),
    // the stock ledger / flags, the confirmation notice and the CRM lead. None of them can undo the booking.
    await this.bookings.afterConfirmed(booking);
    const invoice = await this.billing.findInvoiceForBooking(booking._id).catch(() => null);
    await this.stock.onBookingsConfirmed([booking], now);
    await this.notifications.bookingConfirmed({ bookingReference: booking.reference });
    await this.leads.markWonFromEnquiry(dto.source, enquiry.reference, `Booking ${booking.reference} confirmed`);

    return {
      booking: {
        ...listItem(booking, null),
        quantity: booking.quantity,
        stockProductType: booking.stockProductType ?? null,
        stockProductRef: booking.stockProductRef ?? null,
        stockVariantId: booking.stockVariantId ?? null,
        enquiryReference: enquiry.reference,
      },
      invoiceNumber: invoice?.invoiceNumber ?? null,
      tax: {
        country: taxDetermination.country,
        taxName: taxDetermination.taxName,
        percent: taxDetermination.percent,
        rateCode: taxDetermination.rateCode,
        components: taxDetermination.components,
      },
    };
  }
}
