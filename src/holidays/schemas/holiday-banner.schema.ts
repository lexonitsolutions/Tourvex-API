import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HolidayBannerDocument = HydratedDocument<HolidayBanner>;

@Schema({ timestamps: true, collection: 'holiday_banners' })
export class HolidayBanner {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, trim: true })
  eyebrow?: string;

  @Prop({ type: String, default: '', trim: true })
  subtitle: string;

  @Prop({ type: String, default: '', trim: true })
  description: string;

  @Prop({ type: String, required: true, trim: true })
  image: string;

  @Prop({ type: String, required: true, trim: true })
  ctaLabel: string;

  @Prop({ type: String, required: true, trim: true })
  ctaHref: string;

  @Prop({ type: Number, default: 0 })
  order: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;
}

export const HolidayBannerSchema = SchemaFactory.createForClass(HolidayBanner);
HolidayBannerSchema.index({ published: 1, order: 1 });
