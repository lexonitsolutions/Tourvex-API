import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InvoiceDocument = HydratedDocument<Invoice>;

export enum InvoiceStatus {
  Issued = 'issued',
  Paid = 'paid',
  Refunded = 'refunded',
  Voided = 'voided',
}

export const INVOICE_KINDS = ['invoice', 'credit_note'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

@Schema({ _id: false })
export class InvoiceLine {
  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: Number, required: true, min: 0 })
  qty: number;

  /** Unit price in the invoice currency. */
  @Prop({ type: Number, required: true })
  unitAmount: number;

  @Prop({ type: Number, required: true })
  total: number;
}
export const InvoiceLineSchema = SchemaFactory.createForClass(InvoiceLine);

/** Company details at the moment of issue, so old documents never change when settings do. */
@Schema({ _id: false })
export class InvoiceSeller {
  @Prop({ type: String, default: '' })
  legalName: string;

  @Prop({ type: String, default: '' })
  address: string;

  @Prop({ type: String, default: '' })
  taxNumber: string;

  @Prop({ type: String, default: '' })
  email: string;

  @Prop({ type: String, default: '' })
  phone: string;

  // Added with the tax module; absent on older documents.
  @Prop({ type: String })
  sellerId?: string;

  @Prop({ type: String })
  registrationLabel?: string;

  @Prop({ type: String })
  registrationNumber?: string;

  @Prop({ type: String })
  country?: string;

  @Prop({ type: String })
  state?: string;

  @Prop({ type: String })
  stateCode?: string;

  @Prop({ type: String })
  website?: string;

  @Prop({ type: String })
  bankDetails?: string;
}
export const InvoiceSellerSchema = SchemaFactory.createForClass(InvoiceSeller);

@Schema({ _id: false })
export class InvoiceTaxComponent {
  @Prop({ type: String, required: true })
  code: string;

  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: Number, required: true })
  percent: number;

  @Prop({ type: Number, required: true })
  taxableAmount: number;

  @Prop({ type: Number, required: true })
  taxAmount: number;
}
export const InvoiceTaxComponentSchema = SchemaFactory.createForClass(InvoiceTaxComponent);

/** Tax snapshot of a document (exposed as `taxInfo`: the legacy numeric `tax` field keeps the tax amount). */
@Schema({ _id: false })
export class InvoiceTaxInfo {
  @Prop({ type: String })
  regimeId?: string;

  @Prop({ type: String, required: true })
  country: string;

  @Prop({ type: String, required: true })
  taxName: string;

  @Prop({ type: String, required: true })
  model: string;

  @Prop({ type: String, required: true })
  rateCode: string;

  @Prop({ type: Number, required: true })
  percent: number;

  @Prop({ type: [InvoiceTaxComponentSchema], default: [] })
  components: InvoiceTaxComponent[];

  @Prop({ type: Object })
  placeOfSupply?: { country: string; state?: string; stateCode?: string };

  @Prop({ type: Object })
  serviceCode?: { label: string; value: string; description?: string };

  @Prop({ type: Boolean, default: false })
  reverseCharge: boolean;

  @Prop({ type: Boolean, default: false })
  pricesIncludeTax: boolean;

  /** Layout hints frozen at issue, so the PDF never changes when the regime is edited later. */
  @Prop({ type: String })
  qr?: string;

  @Prop({ type: String })
  registrationLabel?: string;

  @Prop({ type: String })
  notes?: string;
}
export const InvoiceTaxInfoSchema = SchemaFactory.createForClass(InvoiceTaxInfo);

@Schema({ _id: false })
export class InvoiceBuyer {
  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: String, default: '' })
  email: string;

  @Prop({ type: String })
  phone?: string;

  @Prop({ type: String })
  address?: string;

  @Prop({ type: String })
  country?: string;

  @Prop({ type: String })
  state?: string;

  @Prop({ type: String })
  stateCode?: string;

  @Prop({ type: String })
  registrationNumber?: string;
}
export const InvoiceBuyerSchema = SchemaFactory.createForClass(InvoiceBuyer);

export const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

@Schema({ _id: false })
export class InvoiceEmail {
  @Prop({ type: String, enum: EMAIL_STATUSES, default: 'pending' })
  status: EmailStatus;

  @Prop({ type: String })
  to?: string;

  @Prop({ type: Date })
  lastSentAt?: Date;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: String })
  lastError?: string;

  @Prop({ type: String })
  messageId?: string;

  /** The retry sweep leaves a failed e-mail alone until this instant (backoff). */
  @Prop({ type: Date })
  nextAttemptAt?: Date;

  /** Held while a send is in progress, so two processes never send the same e-mail at once. */
  @Prop({ type: Date })
  lockedUntil?: Date;
}
export const InvoiceEmailSchema = SchemaFactory.createForClass(InvoiceEmail);

/**
 * Invoices (kind invoice, number INV-YYYY-000001) and credit notes (kind credit_note,
 * CN-YYYY-000001). Amounts are always positive; a credit note is rendered as a deduction.
 * Documents created before these fields existed lack kind/lines/seller; readers treat them as invoices.
 */
@Schema({ timestamps: true, collection: 'invoices' })
export class Invoice {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  invoiceNumber: string;

  @Prop({ type: String, enum: INVOICE_KINDS })
  kind?: InvoiceKind;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Booking', index: true })
  bookingId: Types.ObjectId;

  @Prop({ type: String, index: true })
  bookingReference?: string;

  @Prop({ type: String })
  orderReference?: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  customerId: Types.ObjectId;

  @Prop({ type: String })
  customerName?: string;

  @Prop({ type: String })
  customerEmail?: string;

  @Prop({ type: Number, min: 0, required: true })
  subtotal: number;

  @Prop({ type: Number, min: 0, default: 0 })
  discount: number;

  @Prop({ type: Number, min: 0, default: 0 })
  tax: number;

  /** Percent used for tax (informational). */
  @Prop({ type: Number, min: 0 })
  taxPercent?: number;

  @Prop({ type: Number, min: 0, required: true })
  total: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, required: true, enum: InvoiceStatus, default: InvoiceStatus.Issued, index: true })
  status: InvoiceStatus;

  @Prop({ type: String })
  paymentReference?: string;

  @Prop({ type: [InvoiceLineSchema], default: undefined })
  lines?: InvoiceLine[];

  @Prop({ type: InvoiceSellerSchema })
  seller?: InvoiceSeller;

  @Prop({ type: Date })
  issuedAt?: Date;

  // Tax module snapshot. All optional: legacy documents lack them and render as before.
  @Prop({ type: String })
  title?: string;

  @Prop({ type: InvoiceTaxInfoSchema })
  taxInfo?: InvoiceTaxInfo;

  @Prop({ type: InvoiceBuyerSchema })
  buyer?: InvoiceBuyer;

  @Prop({ type: InvoiceEmailSchema })
  email?: InvoiceEmail;

  // Credit notes only.
  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  relatedInvoiceId?: Types.ObjectId;

  @Prop({ type: String })
  relatedInvoiceNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'Refund' })
  refundId?: Types.ObjectId;

  @Prop({ type: String, maxlength: 300 })
  reason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ createdAt: -1 });
// One invoice per booking (credit notes may repeat). Legacy documents without kind are not covered
// by the partial index, so the service also looks for them before inserting.
InvoiceSchema.index({ bookingId: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: 'invoice' } });
InvoiceSchema.index({ refundId: 1 }, { unique: true, partialFilterExpression: { refundId: { $exists: true } } });
// Admin list sort, the regime/seller "in use" checks and the e-mail retry sweep.
InvoiceSchema.index({ 'taxInfo.regimeId': 1 }, { sparse: true });
InvoiceSchema.index({ 'seller.sellerId': 1 }, { sparse: true });
InvoiceSchema.index({ 'email.status': 1, 'email.nextAttemptAt': 1 }, { sparse: true });
