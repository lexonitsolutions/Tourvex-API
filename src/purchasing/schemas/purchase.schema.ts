import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PurchaseDocument = HydratedDocument<Purchase>;

export const PURCHASE_STATUSES = ['draft', 'received', 'paid', 'void'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

@Schema({ _id: false })
export class PurchaseLine {
  /** Stock item id `type:ref:variant`. */
  @Prop({ type: String, required: true })
  itemId: string;

  /** Snapshots of the stock item's names at the time the line was saved. */
  @Prop({ type: String, default: '' })
  title: string;

  @Prop({ type: String, default: '' })
  variantLabel: string;

  /** Units added PER DAY. */
  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: String, required: true })
  dateFrom: string;

  @Prop({ type: String, required: true })
  dateTo: string;

  @Prop({ type: [Number], default: undefined })
  weekdays?: number[];

  /** quantity x number of matching dates. */
  @Prop({ type: Number, required: true, min: 1 })
  totalUnits: number;

  @Prop({ type: Number, required: true, min: 0 })
  unitCost: number;

  @Prop({ type: Number, min: 0, max: 100 })
  taxPercent?: number;

  @Prop({ type: Number, required: true, min: 0 })
  lineTotal: number;
}
export const PurchaseLineSchema = SchemaFactory.createForClass(PurchaseLine);

/** A supplier invoice / stock purchase. Receiving it adds the units to stock through the Phase 1 engine. */
@Schema({ timestamps: true, collection: 'purchases' })
export class Purchase {
  _id: Types.ObjectId;

  /** `PUR-YYYY-000001`, gap-free. */
  @Prop({ type: String, required: true })
  number: string;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplierId: Types.ObjectId;

  @Prop({ type: String, required: true })
  supplierName: string;

  /** Absent (never an empty string) when the supplier gave none, so the partial unique index ignores it. */
  @Prop({ type: String, trim: true, maxlength: 80 })
  supplierInvoiceNumber?: string;

  /** Calendar days, YYYY-MM-DD. */
  @Prop({ type: String, required: true })
  invoiceDate: string;

  @Prop({ type: String })
  dueDate?: string;

  @Prop({ type: String, required: true, uppercase: true })
  currency: string;

  @Prop({ type: [PurchaseLineSchema], default: [] })
  lines: PurchaseLine[];

  @Prop({ type: Number, required: true, min: 0 })
  subtotal: number;

  @Prop({ type: Number, required: true, min: 0 })
  taxTotal: number;

  @Prop({ type: Number, required: true, min: 0 })
  total: number;

  @Prop({ type: String, required: true, enum: PURCHASE_STATUSES, default: 'draft' })
  status: PurchaseStatus;

  @Prop({ type: Date })
  receivedAt?: Date;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: String, maxlength: 120 })
  paymentReference?: string;

  @Prop({ type: Date })
  voidedAt?: Date;

  @Prop({ type: String, default: '', maxlength: 2000 })
  notes: string;

  @Prop({ type: String, default: '' })
  createdBy: string;

  createdAt: Date;
  updatedAt: Date;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
PurchaseSchema.index({ number: 1 }, { unique: true });
PurchaseSchema.index(
  { supplierId: 1, supplierInvoiceNumber: 1 },
  { unique: true, partialFilterExpression: { supplierInvoiceNumber: { $type: 'string' } } },
);
PurchaseSchema.index({ status: 1, invoiceDate: -1 });
PurchaseSchema.index({ invoiceDate: -1, createdAt: -1 });
PurchaseSchema.index({ supplierId: 1, invoiceDate: -1 });
PurchaseSchema.index({ 'lines.itemId': 1, status: 1 });
