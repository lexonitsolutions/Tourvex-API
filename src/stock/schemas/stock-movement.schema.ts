import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MOVEMENT_TYPES, PRODUCT_TYPES, type MovementType, type ProductType } from '../stock.types';

export type StockMovementDocument = HydratedDocument<StockMovement>;

/** Append-only stock ledger. Rows are never updated or deleted. */
@Schema({ collection: 'stock_movements', versionKey: false })
export class StockMovement {
  _id: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  at: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  /** `system` for automatic rows (booking confirmed, auto restock, alerts). */
  @Prop({ type: String, default: 'system' })
  actorEmail: string;

  @Prop({ type: String, required: true, enum: PRODUCT_TYPES })
  productType: ProductType;

  @Prop({ type: String, required: true })
  productRef: string;

  @Prop({ type: String, required: true })
  variantId: string;

  @Prop({ type: String, default: '' })
  title: string;

  @Prop({ type: String, required: true, enum: MOVEMENT_TYPES })
  type: MovementType;

  @Prop({ type: String, default: null })
  date: string | null;

  @Prop({ type: Number, default: null })
  before: number | null;

  @Prop({ type: Number, default: null })
  after: number | null;

  @Prop({ type: Number, default: null })
  delta: number | null;

  @Prop({ type: String, default: '', maxlength: 500 })
  reason: string;

  @Prop({ type: String })
  bookingReference?: string;

  @Prop({ type: Object })
  meta?: Record<string, unknown>;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ at: -1 });
StockMovementSchema.index({ productType: 1, productRef: 1, variantId: 1, at: -1 });
StockMovementSchema.index({ type: 1, at: -1 });
// A booking's automatic ledger rows are written once, even when a webhook or sweep repeats.
StockMovementSchema.index(
  { bookingReference: 1, type: 1 },
  { unique: true, partialFilterExpression: { bookingReference: { $exists: true } } },
);
