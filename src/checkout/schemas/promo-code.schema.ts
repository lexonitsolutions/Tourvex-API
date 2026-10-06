import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PromoCodeDocument = HydratedDocument<PromoCode>;

export const PROMO_TYPES = ['percent', 'fixed'] as const;

@Schema({ timestamps: true, collection: 'promo_codes' })
export class PromoCode {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, enum: PROMO_TYPES })
  type: 'percent' | 'fixed';

  /** Percent (1-100) or a fixed AED amount. */
  @Prop({ type: Number, required: true, min: 0 })
  value: number;

  @Prop({ type: Number, min: 0 })
  minSubtotal?: number;

  @Prop({ type: Number, min: 0 })
  maxDiscount?: number;

  @Prop({ type: Date })
  validFrom?: Date;

  @Prop({ type: Date })
  validTo?: Date;

  @Prop({ type: Number, min: 1 })
  usageLimit?: number;

  @Prop({ type: Number, default: 0, min: 0 })
  usedCount: number;

  /** Activity slugs the code applies to; empty means every activity. */
  @Prop({ type: [String], default: [] })
  appliesTo: string[];

  @Prop({ type: Boolean, default: true })
  published: boolean;

  /** Sample codes are rejected in production unless ACTIVITY_SAMPLE_DETAILS=true. */
  @Prop({ type: Boolean, default: false })
  isSample: boolean;

  @Prop({ type: String, trim: true })
  description?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const PromoCodeSchema = SchemaFactory.createForClass(PromoCode);
