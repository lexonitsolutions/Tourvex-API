import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VisaBannerDocument = HydratedDocument<VisaBanner>;

@Schema({ timestamps: true, collection: 'visa_banners' })
export class VisaBanner {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, trim: true })
  eyebrow?: string;

  @Prop({ type: String, default: '', trim: true })
  subtitle: string;

  @Prop({ type: String, default: '', trim: true })
  description: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true, minlength: 2, maxlength: 2 })
  countryCode: string;

  @Prop({ type: String, required: true, trim: true })
  ctaLabel: string;

  @Prop({ type: String, required: true, trim: true })
  ctaHref: string;

  @Prop({ type: Number, default: 0 })
  order: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;
}

export const VisaBannerSchema = SchemaFactory.createForClass(VisaBanner);
VisaBannerSchema.index({ published: 1, order: 1 });
