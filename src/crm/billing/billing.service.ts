import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Model, Types } from 'mongoose';
import { SettingsService } from '../../admin/settings/settings.service';
import { appError } from '../../common/app-error';
import { buildPagination, escapeRegex, parseSort, skipFor } from '../../common/query/paging-query.dto';
import {
  counterKey,
  creditNoteTaxMinor,
  type DocumentPrefix,
  formatDocumentNumber,
  operatingYear,
} from './invoice-rules';
import { Counter } from './schemas/counter.schema';
import {
  Invoice,
  InvoiceLine,
  InvoiceSeller,
  InvoiceStatus,
} from './schemas/invoice.schema';
import type { ListInvoicesDto } from './billing.dto';
import { renderInvoicePdf } from './invoice-pdf';

const toMinor = (amount: number) => Math.round(amount * 100 + Math.sign(amount) * 1e-7);
const fromMinor = (minor: number) => minor / 100;

/** What an invoice needs from a booking (a lean Booking satisfies it). */
export interface InvoiceSource {
  _id: Types.ObjectId;
  reference: string;
  orderReference?: string;
  customerId: Types.ObjectId;
  customer?: { fullName: string; email: string };
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

const INVOICE_SORTS = ['createdAt', 'total', 'invoiceNumber', 'status'] as const;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Invoice.name) private readonly invoices: Model<Invoice>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly settings: SettingsService,
  ) {}

  /** Next number of a sequence; the upsert + $inc is atomic, so two requests never get the same one. */
  async nextNumber(prefix: DocumentPrefix, now = new Date()): Promise<string> {
    const year = operatingYear(now);
    const counter = await this.counters
      .findOneAndUpdate({ _id: counterKey(prefix, year) }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
      .lean()
      .exec();
    return formatDocumentNumber(prefix, year, counter.seq);
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
    }>,
  ) {
    const bookingId = new Types.ObjectId(input.bookingId);
    const existing = await this.invoices
      .findOne({ bookingId, kind: { $ne: 'credit_note' } })
      .exec();
    if (existing) return existing;
    const seller = await this.sellerSnapshot();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.invoices.create({
          ...input,
          bookingId,
          customerId: new Types.ObjectId(input.customerId),
          kind: 'invoice',
          invoiceNumber: await this.nextNumber('INV'),
          status: InvoiceStatus.Paid,
          issuedAt: new Date(),
          seller,
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const raced = await this.invoices.findOne({ bookingId, kind: { $ne: 'credit_note' } }).exec();
        if (raced) return raced;
      }
    }
    throw new Error('could not allocate an invoice number');
  }

  /** Builds and stores the invoice of a confirmed booking (used at confirmation, backfill and lazy download). */
  createForBooking(booking: InvoiceSource, taxPercent?: number) {
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
      taxPercent,
      total: booking.total,
      currency: booking.currency,
      paymentReference: booking.paymentReference ?? '',
      lines,
    });
  }

  /**
   * Credit note for one refund, idempotent per refund (unique refundId). The tax part is
   * proportional; the invoice's status flips to `refunded` once the whole total is credited.
   */
  async createCreditNote(input: CreateCreditNoteInput) {
    const existing = await this.invoices.findOne({ refundId: input.refundId }).exec();
    if (existing) return existing;
    const { booking } = input;
    const related = await this.invoices
      .findOne({ bookingId: booking._id, kind: { $ne: 'credit_note' } })
      .lean()
      .exec();
    const credited = await this.invoices
      .aggregate<{ tax: number }>([
        { $match: { bookingId: booking._id, kind: 'credit_note' } },
        { $group: { _id: null, tax: { $sum: '$tax' } } },
      ])
      .exec();
    const taxMinor = creditNoteTaxMinor({
      totalMinor: toMinor(booking.total),
      taxMinor: toMinor(booking.tax),
      refundMinor: input.refundMinor,
      alreadyRefundedMinor: input.alreadyRefundedMinor,
      alreadyCreditedTaxMinor: toMinor(credited[0]?.tax ?? 0),
    });
    const netMinor = input.refundMinor - taxMinor;
    const seller = related?.seller ?? (await this.sellerSnapshot());
    const document = await this.invoices.create({
      kind: 'credit_note',
      invoiceNumber: await this.nextNumber('CN'),
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
    });
    if (related && input.alreadyRefundedMinor + input.refundMinor >= toMinor(booking.total)) {
      await this.invoices.updateOne({ _id: related._id }, { $set: { status: InvoiceStatus.Refunded } }).exec();
    }
    return document;
  }

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

  /** Renders the stored invoice or credit note as a PDF (company details are the snapshot taken at issue). */
  async pdfFor(invoice: Invoice): Promise<Buffer> {
    const seller = invoice.seller ?? (await this.sellerSnapshot());
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
    });
  }

  toView(invoice: Invoice) {
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
    };
  }
}
