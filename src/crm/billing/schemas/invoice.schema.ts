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
}
export const InvoiceSellerSchema = SchemaFactory.createForClass(InvoiceSeller);

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
