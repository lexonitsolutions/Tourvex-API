import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Model, Types } from 'mongoose';
import { SettingsService } from '../../admin/settings/settings.service';
import { appError } from '../../common/app-error';
import { TransactionService } from '../../common/database/transaction.service';
import { buildPagination, escapeRegex, parseSort, skipFor } from '../../common/query/paging-query.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { type SellerFull, TaxService } from '../../tax/tax.service';
import {
  type ComponentAmount,
  type RegimeRule,
  type TaxDetermination,
  breakdownOf,
  splitCreditNoteTax,
} from '../../tax/tax.rules';
import {
  LEGACY_NUMBERING,
  MAX_EMAIL_ATTEMPTS,
  type NumberingFormat,
  creditNoteTaxMinor,
  type DocumentType,
  emailBackoffMs,
  formatSeriesNumber,
  numberSeries,
  operatingYear,
  safeEmailError,
  seriesCounterKey,
} from './invoice-rules';
import { Counter } from './schemas/counter.schema';
import {
  Invoice,
  InvoiceBuyer,
  InvoiceLine,
  InvoiceSeller,
  InvoiceStatus,
  InvoiceTaxInfo,
} from './schemas/invoice.schema';
import type { ListInvoicesDto } from './billing.dto';
import { renderInvoicePdf } from './invoice-pdf';

const toMinor = (amount: number) => Math.round(amount * 100 + Math.sign(amount) * 1e-7);
const fromMinor = (minor: number) => minor / 100;

/** Newly created documents are e-mailed once; the retry sweep stops looking at documents older than this. */
const EMAIL_RETRY_WINDOW_MS = 7 * 24 * 3_600_000;
/** A send holds the document's e-mail lock this long (a crashed process releases it by itself). */
const EMAIL_LOCK_MS = 2 * 60_000;
/** A fresh document gets this long for its own immediate send before the sweep may pick it up. */
const EMAIL_SWEEP_GRACE_MS = 2 * 60_000;

/** What an invoice needs from a booking (a lean Booking satisfies it). */
export interface InvoiceSource {
  _id: Types.ObjectId;
  reference: string;
  orderReference?: string;
  customerId: Types.ObjectId;
  customer?: { fullName: string; email: string; phoneCountryCode?: string; phone?: string };
  title: string;
  optionName?: string;
  serviceDay?: string;
  quantity: number;
  unitPrice: number;
  priceLines?: { label: string; unit: { amount: number }; qty: number; total: { amount: number } }[];
  subtotal: number;
  discount?: number;
  partnerDiscount?: number;
  tax: number;
  total: number;
  currency: string;
  paymentReference?: string;
  confirmedAt?: Date;
  // Product identity, used to derive the tax country of bookings that predate the tax snapshot.
  serviceType?: string;
  activitySlug?: string;
  stockProductType?: string;
  stockProductRef?: string;
  // Tax snapshot taken when the booking was created.
  taxCountry?: string;
  taxRegimeId?: string;
  taxName?: string;
  taxModel?: string;
  taxRateCode?: string;
  taxPercent?: number;
  taxComponents?: { code: string; label: string; percent: number; taxableAmount: number; taxAmount: number }[];
  taxPricesIncluded?: boolean;
  taxPlaceOfSupply?: { country: string; state?: string; stateCode?: string };
  taxServiceCode?: { label: string; value: string; description?: string };
  taxSellerId?: string;
  invoiceBuyer?: { name?: string; address?: string; country?: string; state?: string; stateCode?: string; registrationNumber?: string };
}

export interface CreateCreditNoteInput {
  booking: InvoiceSource;
  refundId: Types.ObjectId;
  /** Refund amount in minor units. */
  refundMinor: number;
  /** Total refunded before this one, in minor units. */
  alreadyRefundedMinor: number;
  reason: string;
}

/** How a document is numbered and what it snapshots. Without one, the legacy format and counters apply. */
export interface IssueContext {
  title?: string;
  seller?: InvoiceSeller;
  taxInfo?: InvoiceTaxInfo;
  buyer?: InvoiceBuyer;
  numbering?: { format: NumberingFormat; country: string; scope: string };
}

export interface EmailResult {
  sent: boolean;
  to: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
}

const INVOICE_SORTS = ['createdAt', 'total', 'invoiceNumber', 'status'] as const;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Invoice.name) private readonly invoices: Model<Invoice>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly settings: SettingsService,
    private readonly tax: TaxService,
    private readonly notifications: NotificationsService,
    private readonly transactions: TransactionService,
  ) {}

  // ---------------------------------------------------------------- numbering

  /**
   * Inserts a document with the next number of its series. The counter increment and the insert are ONE transaction,
   * so a failed insert (duplicate booking, validation) rolls the number back: numbers are gap-free and unique per
   * (seller, document type, year) even under concurrency (concurrent transactions on one counter conflict and are
   * re-run by the transaction helper).
   */
  private async issue(
    type: DocumentType,
    context: IssueContext | undefined,
    document: (number: string) => Record<string, unknown>,
    now = new Date(),
  ) {
    const numbering = context?.numbering ?? { format: LEGACY_NUMBERING, country: 'AE', scope: 'legacy' };
    const year = operatingYear(now);
    const series = numberSeries(numbering.format, type, numbering.country, year);
    const key = seriesCounterKey(numbering.scope, series);
    // The counter must exist before the transaction: two transactions upserting the same new id would collide.
    await this.counters.updateOne({ _id: key }, { $setOnInsert: { seq: 0 } }, { upsert: true }).exec().catch((error: { code?: number }) => {
      if (error.code !== 11000) throw error;
    });
    return this.transactions.run(async (session) => {
      const counter = await this.counters
        .findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { returnDocument: 'after', session })
        .lean()
        .exec();
      const number = formatSeriesNumber(numbering.format, type, numbering.country, year, counter!.seq);
      const [created] = await this.invoices.create([{ ...document(number), invoiceNumber: number }], { session });
      return created;
    });
  }

  async sellerSnapshot(): Promise<InvoiceSeller> {
    const general = (await this.settings.get('general')) as Record<string, string | undefined>;
    return {
      legalName: general.legalName || general.siteName || '',
      address: general.address || '',
      taxNumber: general.taxNumber || '',
      email: general.supportEmail || '',
      phone: general.supportPhone || '',
    };
  }

  private snapshotSeller(seller: SellerFull, regime: RegimeRule | null): InvoiceSeller {
    return {
      sellerId: seller.id,
      legalName: seller.legalName,
      address: seller.address,
      taxNumber: seller.registrationNumber,
      registrationNumber: seller.registrationNumber,
      registrationLabel: regime?.registrationLabel,
      country: seller.country,
      state: seller.state ?? '',
      stateCode: seller.stateCode ?? '',
      email: seller.email,
      phone: seller.phone,
      website: seller.website,
      bankDetails: seller.bankDetails,
    };
  }

  // ---------------------------------------------------------------- creating

  /**
   * One invoice per booking, idempotent: a repeat (retry, concurrent confirm, backfill) returns the
   * existing one. Legacy invoices created before `kind` existed count as the booking's invoice.
   */
  async createPaidInvoice(
    input: {
      bookingId: string;
      customerId: string;
      subtotal: number;
      discount: number;
      tax: number;
      total: number;
      currency: string;
      paymentReference: string;
    } & Partial<{
      bookingReference: string;
      orderReference: string;
      customerName: string;
      customerEmail: string;
      lines: InvoiceLine[];
      taxPercent: number;
      context: IssueContext;
    }>,
  ) {
    const { context, ...fields } = input;
    const bookingId = new Types.ObjectId(input.bookingId);
    const existing = await this.invoices.findOne({ bookingId, kind: { $ne: 'credit_note' } }).exec();
    if (existing) return existing;
    const seller = context?.seller ?? (await this.sellerSnapshot());
    const recipient = context?.buyer?.email || input.customerEmail || '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await this.issue('INV', context, () => ({
          ...fields,
          bookingId,
          customerId: new Types.ObjectId(input.customerId),
          kind: 'invoice',
          status: InvoiceStatus.Paid,
          issuedAt: new Date(),
          seller,
          ...(context?.title && { title: context.title }),
          ...(context?.taxInfo && { taxInfo: context.taxInfo }),
          ...(context?.buyer && { buyer: context.buyer }),
          email: { status: recipient ? 'pending' : 'skipped', attempts: 0, ...(recipient && { to: recipient }) },
        }));
        this.queueEmail(created._id.toString());
        return created;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const raced = await this.invoices.findOne({ bookingId, kind: { $ne: 'credit_note' } }).exec();
        if (raced) return raced;
      }
    }
    throw new Error('could not allocate an invoice number');
  }

  /** Tax snapshot, seller, buyer and numbering of a booking's invoice (what the customer paid is what it says). */
  private async issueContextFor(booking: InvoiceSource): Promise<IssueContext> {
    const totalMinor = toMinor(booking.total);
    const taxMinor = toMinor(booking.tax);
    const netMinor = totalMinor - taxMinor;

    let det: Pick<TaxDetermination, 'regimeId' | 'country' | 'taxName' | 'model' | 'rateCode' | 'percent' | 'placeOfSupply' | 'serviceCode' | 'pricesIncludeTax' | 'sellerId'>;
    let components: ComponentAmount[];
    if (booking.taxCountry && booking.taxComponents?.length) {
      det = {
        regimeId: booking.taxRegimeId ?? null,
        country: booking.taxCountry,
        taxName: booking.taxName ?? 'VAT',
        model: (booking.taxModel as 'single' | 'india_gst') ?? 'single',
        rateCode: booking.taxRateCode ?? 'standard',
        percent: booking.taxPercent ?? 0,
        placeOfSupply: booking.taxPlaceOfSupply ?? { country: booking.taxCountry },
        serviceCode: booking.taxServiceCode,
        pricesIncludeTax: Boolean(booking.taxPricesIncluded),
        sellerId: booking.taxSellerId ?? null,
      };
      components = booking.taxComponents.map((c) => ({
        code: c.code as ComponentAmount['code'],
        label: c.label,
        percent: c.percent,
        taxableMinor: toMinor(c.taxableAmount),
        taxMinor: toMinor(c.taxAmount),
      }));
    } else {
      // A booking from before the tax module: the supply is taxed by the country of its product, split from the tax it carries.
      const type = booking.stockProductType ?? (booking.activitySlug ? 'activity' : (booking.serviceType ?? 'activity'));
      const ref = booking.stockProductRef ?? booking.activitySlug ?? '';
      const found = await this.tax.determine({ serviceCountry: await this.tax.countryForProduct(type, ref) });
      det = found;
      components = breakdownOf(netMinor, taxMinor, found.components).components;
      if (booking.taxPercent !== undefined) det = { ...det, percent: booking.taxPercent };
    }

    const regime = await this.tax.regimeById(det.regimeId);
    const sellerFull = await this.tax.sellerById(det.sellerId);
    const seller = sellerFull ? this.snapshotSeller(sellerFull, regime) : await this.sellerSnapshot();

    const customer = booking.customer;
    const phone = customer?.phone && customer.phone !== 'n/a' ? `${customer.phoneCountryCode && customer.phoneCountryCode !== 'n/a' ? customer.phoneCountryCode + ' ' : ''}${customer.phone}` : undefined;
    const given = booking.invoiceBuyer;
    const buyer: InvoiceBuyer = {
      name: given?.name || customer?.fullName || '',
      email: customer?.email || '',
      ...(phone && { phone }),
      ...(given?.address && { address: given.address }),
      ...(given?.country && { country: given.country }),
      ...(given?.state && { state: given.state }),
      ...(given?.stateCode && { stateCode: given.stateCode }),
      ...(given?.registrationNumber && { registrationNumber: given.registrationNumber }),
    };

    const taxInfo: InvoiceTaxInfo = {
      ...(det.regimeId && { regimeId: det.regimeId }),
      country: det.country,
      taxName: det.taxName,
      model: det.model,
      rateCode: det.rateCode,
      percent: det.percent,
      components: components.map((c) => ({
        code: c.code,
        label: c.label,
        percent: c.percent,
        taxableAmount: fromMinor(netMinor),
        taxAmount: fromMinor(c.taxMinor),
      })),
      placeOfSupply: det.placeOfSupply,
      ...(det.serviceCode && { serviceCode: det.serviceCode }),
      reverseCharge: false,
      pricesIncludeTax: det.pricesIncludeTax,
      ...(regime?.qr && regime.qr !== 'none' && { qr: regime.qr }),
      ...(regime?.registrationLabel && { registrationLabel: regime.registrationLabel }),
      ...(regime?.invoiceNotes && { notes: regime.invoiceNotes }),
    };

    return {
      title: regime?.invoiceTitle || 'Tax Invoice',
      seller,
      taxInfo,
      buyer,
      numbering: {
        format: regime?.numbering ?? LEGACY_NUMBERING,
        country: det.country,
        scope: sellerFull?.numberingScope ?? 'legacy',
      },
    };
  }

  /** Builds and stores the invoice of a confirmed booking (used at confirmation, backfill and lazy download). */
  async createForBooking(booking: InvoiceSource, taxPercent?: number) {
    const discount = booking.discount ?? booking.partnerDiscount ?? 0;
    const lines: InvoiceLine[] = booking.priceLines?.length
      ? booking.priceLines.map((line) => ({
          label: line.label,
          qty: line.qty,
          unitAmount: line.unit.amount,
          total: line.total.amount,
        }))
      : [
          {
            label: booking.optionName ? `${booking.title} (${booking.optionName})` : booking.title,
            qty: booking.quantity,
            unitAmount: booking.unitPrice,
            total: booking.subtotal,
          },
        ];
    const existing = await this.findInvoiceForBooking(booking._id);
    const context = existing ? undefined : await this.issueContextFor(booking);
    return this.createPaidInvoice({
      bookingId: booking._id.toString(),
      customerId: booking.customerId.toString(),
      bookingReference: booking.reference,
      orderReference: booking.orderReference,
      customerName: booking.customer?.fullName,
      customerEmail: booking.customer?.email,
      subtotal: booking.subtotal,
      discount,
      tax: booking.tax,
      taxPercent: booking.taxPercent ?? taxPercent,
      total: booking.total,
      currency: booking.currency,
      paymentReference: booking.paymentReference ?? '',
      lines,
      context,
    });
  }

  /**
   * Credit note for one refund, idempotent per refund (unique refundId). The tax part is proportional and split over
   * the invoice's components so the credit notes of a booking add up exactly to its invoice; the invoice's status
   * flips to `refunded` once the whole total is credited.
   */
  async createCreditNote(input: CreateCreditNoteInput) {
    const existing = await this.invoices.findOne({ refundId: input.refundId }).exec();
    if (existing) return existing;
    const { booking } = input;
    const related = await this.invoices
      .findOne({ bookingId: booking._id, kind: { $ne: 'credit_note' } })
      .lean()
      .exec();
    const previous = await this.invoices
      .find({ bookingId: booking._id, kind: 'credit_note' })
      .select('tax taxInfo')
      .lean()
      .exec();
    const creditedTaxMinor = previous.reduce((sum, note) => sum + toMinor(note.tax ?? 0), 0);
    let taxMinor = creditNoteTaxMinor({
      totalMinor: toMinor(booking.total),
      taxMinor: toMinor(booking.tax),
      refundMinor: input.refundMinor,
      alreadyRefundedMinor: input.alreadyRefundedMinor,
      alreadyCreditedTaxMinor: creditedTaxMinor,
    });

    let taxInfo: InvoiceTaxInfo | undefined;
    const invoiceTax = related?.taxInfo;
    if (invoiceTax?.components?.length) {
      const credited = invoiceTax.components.map((component) =>
        previous.reduce(
          (sum, note) => sum + toMinor(note.taxInfo?.components?.find((c) => c.code === component.code)?.taxAmount ?? 0),
          0,
        ),
      );
      const parts = splitCreditNoteTax(taxMinor, invoiceTax.components.map((c) => toMinor(c.taxAmount)), credited);
      taxMinor = parts.reduce((a, b) => a + b, 0);
      taxInfo = {
        ...invoiceTax,
        components: invoiceTax.components.map((component, i) => ({
          code: component.code,
          label: component.label,
          percent: component.percent,
          taxableAmount: fromMinor(input.refundMinor - taxMinor),
          taxAmount: fromMinor(parts[i]),
        })),
      };
    }
    const netMinor = input.refundMinor - taxMinor;
    const seller = related?.seller ?? (await this.sellerSnapshot());

    // Same series rules as the invoice: the regime and the seller that issued it decide the numbering.
    let numbering: IssueContext['numbering'];
    if (related?.taxInfo?.regimeId) {
      const regime = await this.tax.regimeById(related.taxInfo.regimeId);
      const sellerFull = await this.tax.sellerById(related.seller?.sellerId);
      if (regime) numbering = { format: regime.numbering, country: regime.country, scope: sellerFull?.numberingScope ?? 'legacy' };
    } else if (related?.seller?.sellerId) {
      const sellerFull = await this.tax.sellerById(related.seller.sellerId);
      if (sellerFull) numbering = { format: LEGACY_NUMBERING, country: 'AE', scope: sellerFull.numberingScope };
    }
    const recipient = related?.buyer?.email || booking.customer?.email || '';

    const document = await this.issue('CN', { numbering }, () => ({
      kind: 'credit_note',
      bookingId: booking._id,
      bookingReference: booking.reference,
      orderReference: booking.orderReference,
      customerId: booking.customerId,
      customerName: booking.customer?.fullName,
      customerEmail: booking.customer?.email,
      subtotal: fromMinor(netMinor),
      discount: 0,
      tax: fromMinor(taxMinor),
      total: fromMinor(input.refundMinor),
      currency: booking.currency,
      status: InvoiceStatus.Issued,
      paymentReference: booking.paymentReference,
      lines: [{ label: `Refund: ${booking.title} (${booking.reference})`, qty: 1, unitAmount: fromMinor(netMinor), total: fromMinor(netMinor) }],
      seller,
      issuedAt: new Date(),
      relatedInvoiceId: related?._id,
      relatedInvoiceNumber: related?.invoiceNumber,
      refundId: input.refundId,
      reason: input.reason.slice(0, 300),
      ...(related?.taxInfo && { title: 'Credit Note', taxInfo }),
      ...(related?.buyer && { buyer: related.buyer }),
      email: { status: recipient ? 'pending' : 'skipped', attempts: 0, ...(recipient && { to: recipient }) },
    }));
    if (related && input.alreadyRefundedMinor + input.refundMinor >= toMinor(booking.total)) {
      await this.invoices.updateOne({ _id: related._id }, { $set: { status: InvoiceStatus.Refunded } }).exec();
    }
    this.queueEmail(document._id.toString());
    return document;
  }

  // ---------------------------------------------------------------- reads

  /** Legacy list used by the old Finance-role endpoint. */
  list() {
    return this.invoices.find().sort({ createdAt: -1 }).lean().exec();
  }

  async search(query: ListInvoicesDto) {
    const filter: QueryFilter<Invoice> = {};
    if (query.status) filter.status = query.status;
    if (query.kind === 'credit_note') filter.kind = 'credit_note';
    else if (query.kind === 'invoice') filter.kind = { $ne: 'credit_note' };
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from && { $gte: new Date(query.from) }),
        ...(query.to && { $lte: new Date(query.to) }),
      };
    }
    const q = query.q?.trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { invoiceNumber: pattern },
        { bookingReference: pattern },
        { orderReference: pattern },
        { customerName: pattern },
        { customerEmail: pattern },
      ];
    }
    const sort = parseSort(query.sort, INVOICE_SORTS, { field: 'createdAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.invoices.find(filter).sort(sort).skip(skipFor(query.page, query.limit)).limit(query.limit).lean().exec(),
      this.invoices.countDocuments(filter).exec(),
    ]);
    return { items: rows.map((row) => this.toView(row)), pagination: buildPagination(query.page, query.limit, total) };
  }

  async *exportRows(query: ListInvoicesDto) {
    for (let page = 1; page <= 100; page++) {
      const { items, pagination } = await this.search({ ...query, page, limit: 100 });
      yield* items;
      if (page >= pagination.pages) return;
    }
  }

  async getById(id: string) {
    const invoice = await this.invoices.findById(id).lean().exec();
    if (!invoice) throw appError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    return invoice;
  }

  /** The invoice of a booking (not its credit notes), if one exists. */
  findInvoiceForBooking(bookingId: string | Types.ObjectId) {
    return this.invoices
      .findOne({ bookingId: new Types.ObjectId(bookingId), kind: { $ne: 'credit_note' } })
      .lean()
      .exec();
  }

  creditNotesForBooking(bookingId: string | Types.ObjectId) {
    return this.invoices
      .find({ bookingId: new Types.ObjectId(bookingId), kind: 'credit_note' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  /** Renders the stored invoice or credit note as a PDF (all details are the snapshot taken at issue). */
  async pdfFor(invoice: Invoice): Promise<Buffer> {
    const seller = invoice.seller ?? (await this.sellerSnapshot());
    const details = invoice.taxInfo;
    return renderInvoicePdf({
      kind: invoice.kind ?? 'invoice',
      number: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt ?? invoice.createdAt,
      status: invoice.status,
      currency: invoice.currency,
      seller,
      customer: { name: invoice.customerName ?? '', email: invoice.customerEmail ?? '' },
      bookingReference: invoice.bookingReference,
      orderReference: invoice.orderReference,
      relatedInvoiceNumber: invoice.relatedInvoiceNumber,
      paymentReference: invoice.paymentReference,
      reason: invoice.reason,
      lines: invoice.lines?.length
        ? invoice.lines
        : [{ label: 'Booking ' + (invoice.bookingReference ?? ''), qty: 1, unitAmount: invoice.subtotal, total: invoice.subtotal }],
      subtotal: invoice.subtotal,
      discount: invoice.discount ?? 0,
      tax: invoice.tax ?? 0,
      taxPercent: invoice.taxPercent,
      total: invoice.total,
      ...(details && {
        title: invoice.title,
        taxInfo: {
          country: details.country,
          taxName: details.taxName,
          model: details.model,
          rateCode: details.rateCode,
          percent: details.percent,
          components: details.components ?? [],
          placeOfSupply: details.placeOfSupply,
          serviceCode: details.serviceCode,
          pricesIncludeTax: Boolean(details.pricesIncludeTax),
          reverseCharge: details.reverseCharge,
          qr: details.qr,
          registrationLabel: details.registrationLabel ?? seller.registrationLabel,
          notes: details.notes,
        },
        buyer: invoice.buyer ?? { name: invoice.customerName ?? '', email: invoice.customerEmail ?? '' },
      }),
    });
  }

  toView(invoice: Invoice) {
    const details = invoice.taxInfo;
    const email = invoice.email;
    return {
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      kind: invoice.kind ?? 'invoice',
      status: invoice.status,
      bookingId: invoice.bookingId.toString(),
      bookingReference: invoice.bookingReference ?? null,
      orderReference: invoice.orderReference ?? null,
      customerName: invoice.customerName ?? null,
      customerEmail: invoice.customerEmail ?? null,
      subtotal: invoice.subtotal,
      discount: invoice.discount ?? 0,
      tax: invoice.tax ?? 0,
      taxPercent: invoice.taxPercent ?? null,
      total: invoice.total,
      currency: invoice.currency,
      paymentReference: invoice.paymentReference ?? null,
      lines: invoice.lines ?? [],
      seller: invoice.seller ?? null,
      issuedAt: invoice.issuedAt ?? invoice.createdAt,
      createdAt: invoice.createdAt,
      relatedInvoiceId: invoice.relatedInvoiceId?.toString() ?? null,
      relatedInvoiceNumber: invoice.relatedInvoiceNumber ?? null,
      reason: invoice.reason ?? null,
      // Tax module snapshot (null on legacy documents). The numeric `tax` above stays the tax amount.
      title: invoice.title ?? null,
      taxCountry: details?.country ?? null,
      taxName: details?.taxName ?? null,
      taxInfo: details
        ? {
            regimeId: details.regimeId ?? null,
            country: details.country,
            taxName: details.taxName,
            model: details.model,
            rateCode: details.rateCode,
            percent: details.percent,
            components: (details.components ?? []).map((c) => ({
              code: c.code,
              label: c.label,
              percent: c.percent,
              taxableAmount: c.taxableAmount,
              taxAmount: c.taxAmount,
            })),
            placeOfSupply: details.placeOfSupply ?? null,
            serviceCode: details.serviceCode ?? null,
            reverseCharge: Boolean(details.reverseCharge),
            pricesIncludeTax: Boolean(details.pricesIncludeTax),
          }
        : null,
      buyer: invoice.buyer ?? null,
      emailStatus: email?.status ?? null,
      email: email
        ? {
            status: email.status,
            to: email.to ?? null,
            lastSentAt: email.lastSentAt ?? null,
            attempts: email.attempts ?? 0,
            lastError: email.lastError ?? null,
            messageId: email.messageId ?? null,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------- e-mail

  /** Sends the document right after creation without blocking or failing the booking / refund. */
  private queueEmail(id: string): void {
    if (!this.notifications.emailEnabled) return;
    void this.deliverEmail(id, { manual: false }).catch((error: Error) => {
      this.logger.warn(`Automatic e-mail of document ${id} failed unexpectedly: ${safeEmailError(error.message)}`);
    });
  }

  /**
   * E-mails an invoice or credit note with its PDF and records the outcome on the document. The send is claimed with
   * an atomic lock, so a repeat (webhook retry, sweep, double click) never sends it twice at the same time. Automatic
   * sends only handle `pending` / `failed` documents; a manual resend sends again whatever the status.
   */
  async deliverEmail(id: string, options: { manual: boolean; to?: string }, now = new Date()): Promise<EmailResult> {
    if (!this.notifications.emailEnabled) {
      if (options.manual) throw appError(409, 'EMAIL_NOT_CONFIGURED', 'E-mail is not configured (set SMTP_HOST); nothing was sent');
      return { sent: false, to: '', status: 'pending', attempts: 0 };
    }
    const lockFree = { $or: [{ 'email.lockedUntil': null }, { 'email.lockedUntil': { $lte: now } }] };
    const claim: QueryFilter<Invoice> = options.manual
      ? { _id: id, ...lockFree }
      : { _id: id, 'email.status': { $in: ['pending', 'failed'] }, 'email.attempts': { $lt: MAX_EMAIL_ATTEMPTS }, ...lockFree };
    const invoice = await this.invoices
      .findOneAndUpdate(claim, { $set: { 'email.lockedUntil': new Date(now.getTime() + EMAIL_LOCK_MS) } }, { returnDocument: 'after' })
      .lean()
      .exec();
    if (!invoice) {
      const current = await this.invoices.findById(id).select('email').lean().exec();
      if (!current) throw appError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
      return {
        sent: current.email?.status === 'sent',
        to: current.email?.to ?? '',
        status: current.email?.status ?? 'pending',
        attempts: current.email?.attempts ?? 0,
      };
    }

    const to = (options.to || invoice.email?.to || invoice.buyer?.email || invoice.customerEmail || '').trim();
    const attempts = invoice.email?.attempts ?? 0;
    if (!to) {
      await this.invoices.updateOne({ _id: invoice._id }, { $set: { 'email.status': 'skipped' }, $unset: { 'email.lockedUntil': 1 } }).exec();
      if (options.manual) throw appError(400, 'NO_RECIPIENT', 'There is no e-mail address to send this document to');
      return { sent: false, to: '', status: 'skipped', attempts };
    }

    try {
      const pdf = await this.pdfFor(invoice);
      const general = (await this.settings.get('general')) as Record<string, string | undefined>;
      const result = await this.notifications.sendInvoiceEmail({
        to,
        kind: invoice.kind ?? 'invoice',
        number: invoice.invoiceNumber,
        customerName: invoice.buyer?.name || invoice.customerName || '',
        bookingReference: invoice.bookingReference,
        relatedInvoiceNumber: invoice.relatedInvoiceNumber,
        currency: invoice.currency,
        total: invoice.total,
        sellerName: invoice.seller?.legalName || general.siteName || 'Karnish Tourism',
        supportEmail: invoice.seller?.email || general.supportEmail || undefined,
        pdf: { filename: `${invoice.invoiceNumber}.pdf`, content: pdf },
      });
      await this.invoices
        .updateOne(
          { _id: invoice._id },
          {
            $set: { 'email.status': 'sent', 'email.to': to, 'email.lastSentAt': new Date(), ...(result.messageId && { 'email.messageId': result.messageId }) },
            $inc: { 'email.attempts': 1 },
            $unset: { 'email.lockedUntil': 1, 'email.lastError': 1, 'email.nextAttemptAt': 1 },
          },
        )
        .exec();
      return { sent: true, to, status: 'sent', attempts: attempts + 1 };
    } catch (error) {
      const reason = safeEmailError((error as Error).message ?? 'unknown error');
      await this.invoices
        .updateOne(
          { _id: invoice._id },
          {
            $set: {
              'email.status': 'failed',
              'email.to': to,
              'email.lastError': reason,
              'email.nextAttemptAt': new Date(now.getTime() + emailBackoffMs(attempts + 1)),
            },
            $inc: { 'email.attempts': 1 },
            $unset: { 'email.lockedUntil': 1 },
          },
        )
        .exec();
      this.logger.warn(`E-mail of ${invoice.invoiceNumber} failed (attempt ${attempts + 1}): ${reason}`);
      return { sent: false, to, status: 'failed', attempts: attempts + 1 };
    }
  }

  /** `POST /admin/invoices/:id/email`. */
  emailInvoice(id: string, to?: string): Promise<EmailResult> {
    return this.deliverEmail(id, { manual: true, to });
  }

  /**
   * Retry sweep (runs next to the order reconciliation sweep): sends documents still `pending` (the immediate send was
   * lost) and retries `failed` ones after their backoff, up to MAX_EMAIL_ATTEMPTS. Does nothing without SMTP. Never throws.
   */
  async retryEmails(now = new Date()): Promise<number> {
    if (!this.notifications.emailEnabled) return 0;
    let sent = 0;
    try {
      const due = await this.invoices
        .find({
          'email.status': { $in: ['pending', 'failed'] },
          'email.attempts': { $lt: MAX_EMAIL_ATTEMPTS },
          createdAt: { $gte: new Date(now.getTime() - EMAIL_RETRY_WINDOW_MS) },
          $and: [
            { $or: [{ 'email.nextAttemptAt': null }, { 'email.nextAttemptAt': { $lte: now } }] },
            { $or: [{ 'email.lockedUntil': null }, { 'email.lockedUntil': { $lte: now } }] },
            { $or: [{ 'email.status': 'failed' }, { createdAt: { $lte: new Date(now.getTime() - EMAIL_SWEEP_GRACE_MS) } }] },
          ],
        })
        .sort({ createdAt: 1 })
        .limit(20)
        .select('_id')
        .lean()
        .exec();
      for (const { _id } of due) {
        const result = await this.deliverEmail(_id.toString(), { manual: false }, now);
        if (result.sent) sent += 1;
      }
    } catch (error) {
      this.logger.warn(`Invoice e-mail retry sweep failed: ${safeEmailError((error as Error).message)}`);
    }
    return sent;
  }
}
