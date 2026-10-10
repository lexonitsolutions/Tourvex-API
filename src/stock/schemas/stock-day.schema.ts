import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PRODUCT_TYPES, type ProductType } from '../stock.types';

export type StockDayDocument = HydratedDocument<StockDay>;

/** A per-date override of one item: its own capacity, and/or the date closed to sales. */
@Schema({ timestamps: true, collection: 'stock_days' })
export class StockDay {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, enum: PRODUCT_TYPES })
  productType: ProductType;

  @Prop({ type: String, required: true, trim: true })
  productRef: string;

  @Prop({ type: String, required: true, trim: true })
  variantId: string;

  /** Service day, YYYY-MM-DD (operating time zone). */
  @Prop({ type: String, required: true })
  date: string;

  /** Capacity for this date; null = no capacity override (the item default applies). */
  @Prop({ type: Number, min: 0, default: null })
  capacity: number | null;

  @Prop({ type: Boolean, default: false })
  closed: boolean;

  @Prop({ type: String, default: '', trim: true, maxlength: 300 })
  note: string;

  createdAt: Date;
  updatedAt: Date;
}

export const StockDaySchema = SchemaFactory.createForClass(StockDay);
StockDaySchema.index({ productType: 1, productRef: 1, variantId: 1, date: 1 }, { unique: true });
StockDaySchema.index({ date: 1 });
