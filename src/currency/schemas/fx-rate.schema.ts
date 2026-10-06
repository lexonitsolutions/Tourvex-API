import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FxRateDocument = HydratedDocument<FxRate>;

@Schema({ collection: 'fx_rates' })
export class FxRate {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, default: 'AED' })
  base: string;

  @Prop({ type: Object, required: true })
  rates: Record<string, number>;

  @Prop({ type: Date, required: true })
  providerUpdatedAt: Date;

  @Prop({ type: Date, required: true })
  fetchedAt: Date;

  @Prop({ type: String, required: true })
  source: string;
}

export const FxRateSchema = SchemaFactory.createForClass(FxRate);
