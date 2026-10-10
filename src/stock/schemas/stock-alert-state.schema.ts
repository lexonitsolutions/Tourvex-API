import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PRODUCT_TYPES, type ProductType } from '../stock.types';

export type StockAlertStateDocument = HydratedDocument<StockAlertState>;

/**
 * "This (item, date, state) was already alerted." The unique key makes the alert fire exactly once, also across
 * several API instances; the row is removed when the state recovers so a relapse alerts again.
 */
@Schema({ collection: 'stock_alert_states', versionKey: false })
export class StockAlertState {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, enum: PRODUCT_TYPES })
  productType: ProductType;

  @Prop({ type: String, required: true })
  productRef: string;

  @Prop({ type: String, required: true })
  variantId: string;

  @Prop({ type: String, required: true })
  date: string;

  @Prop({ type: String, required: true, enum: ['low', 'sold_out'] })
  state: 'low' | 'sold_out';

  @Prop({ type: Date, default: Date.now })
  alertedAt: Date;
}

export const StockAlertStateSchema = SchemaFactory.createForClass(StockAlertState);
StockAlertStateSchema.index({ productType: 1, productRef: 1, variantId: 1, date: 1, state: 1 }, { unique: true });
