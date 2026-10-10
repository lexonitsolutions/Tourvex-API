import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Denormalised stock flags on activities, holidays, cruises and events, so public lists can filter sold-out products
 * with one indexed condition. Written only by `StockService` (after every stock change and by the periodic sweep).
 */
@Schema({ _id: false })
export class StockStatus {
  @Prop({ type: Boolean, default: false })
  soldOut: boolean;

  @Prop({ type: Boolean, default: false })
  lowStock: boolean;

  /** First bookable service day (YYYY-MM-DD), null when none in the next 120 days. */
  @Prop({ type: String, default: null })
  nextAvailableDate: string | null;

  /** Lowest remaining units within the next 14 days, only while `lowStock`. */
  @Prop({ type: Number, default: null })
  lowestRemaining: number | null;

  @Prop({ type: Date })
  checkedAt: Date;
}
export const StockStatusSchema = SchemaFactory.createForClass(StockStatus);
