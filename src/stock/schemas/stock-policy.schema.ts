import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DEFAULT_LOW_STOCK_THRESHOLD, PRODUCT_TYPES, type ProductType } from '../stock.types';

export type StockPolicyDocument = HydratedDocument<StockPolicy>;

/**
 * Stock rules of one item (product + variant). Created lazily on the first edit of a catalog item, or when an admin
 * creates a manual item. Catalog items without a policy are unlimited (virtual items).
 */
@Schema({ timestamps: true, collection: 'stock_policies' })
export class StockPolicy {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, enum: PRODUCT_TYPES })
  productType: ProductType;

  @Prop({ type: String, required: true, trim: true })
  productRef: string;

  @Prop({ type: String, required: true, trim: true })
  variantId: string;

  @Prop({ type: String, default: '', trim: true })
  title: string;

  @Prop({ type: String, default: '', trim: true })
  variantLabel: string;

  /** Tickets per day; null = unlimited. */
  @Prop({ type: Number, min: 0, default: null })
  defaultCapacity: number | null;

  @Prop({ type: Number, min: 0, default: DEFAULT_LOW_STOCK_THRESHOLD })
  lowStockThreshold: number;

  @Prop({ type: Boolean, default: false })
  stopSale: boolean;

  /** Hours before the service start up to which a cancellation returns the units; unset = the option's cutoff or 24. */
  @Prop({ type: Number, min: 0, default: null })
  restockCutoffHours?: number | null;

  /** Cost per unit; used by the Phase 2 margin reports. */
  @Prop({ type: Number, min: 0, default: null })
  unitCost?: number | null;

  @Prop({ type: Boolean, default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const StockPolicySchema = SchemaFactory.createForClass(StockPolicy);
StockPolicySchema.index({ productType: 1, productRef: 1, variantId: 1 }, { unique: true });
StockPolicySchema.index({ productType: 1, title: 1 });
