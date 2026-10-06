import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HolidayDocument = HydratedDocument<Holiday>;

@Schema({ _id: false })
export class HolidayMoney {
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;
}
export const HolidayMoneySchema = SchemaFactory.createForClass(HolidayMoney);

@Schema({ _id: false })
export class HolidayImage {
  @Prop({ type: String, required: true, trim: true })
  url: string;

  @Prop({ type: String, required: true, trim: true })
  alt: string;
}
export const HolidayImageSchema = SchemaFactory.createForClass(HolidayImage);

@Schema({ _id: false })
export class HolidayItineraryDay {
  @Prop({ type: Number, required: true, min: 1 })
  day: number;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: true, trim: true })
  description: string;
}
export const HolidayItineraryDaySchema = SchemaFactory.createForClass(HolidayItineraryDay);

@Schema({ _id: false })
export class HolidayRating {
  @Prop({ type: Number, required: true, min: 0, max: 5 })
  average: number;

  @Prop({ type: Number, required: true, min: 0 })
  count: number;
}
export const HolidayRatingSchema = SchemaFactory.createForClass(HolidayRating);

@Schema({ timestamps: true, collection: 'holidays' })
export class Holiday {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, trim: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '', trim: true })
  summary: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: [String], default: [], index: true })
  destinations: string[];

  @Prop({ type: String, required: true, trim: true, index: true })
  country: string;

  @Prop({ type: Number, required: true, min: 0, index: true })
  durationNights: number;

  @Prop({ type: Number, required: true, min: 1 })
  durationDays: number;

  @Prop({ type: HolidayMoneySchema, default: null })
  price?: HolidayMoney | null;

  @Prop({ type: HolidayMoneySchema, default: null })
  salePrice?: HolidayMoney | null;

  @Prop({ type: [HolidayImageSchema], default: [] })
  images: HolidayImage[];

  @Prop({ type: [String], default: [] })
  highlights: string[];

  @Prop({ type: [String], default: [] })
  inclusions: string[];

  @Prop({ type: [String], default: [] })
  exclusions: string[];

  @Prop({ type: [HolidayItineraryDaySchema], default: [] })
  itinerary: HolidayItineraryDay[];

  @Prop({ type: [String], default: [], index: true })
  themes: string[];

  @Prop({ type: [String], default: [], index: true })
  collections: string[];

  @Prop({ type: HolidayRatingSchema, default: null })
  rating?: HolidayRating | null;

  @Prop({ type: Number, default: 0 })
  popularity: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;

  @Prop({ type: Boolean, default: false })
  isSample: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const HolidaySchema = SchemaFactory.createForClass(Holiday);
HolidaySchema.index(
  { title: 'text', summary: 'text', destinations: 'text', themes: 'text' },
  { weights: { title: 10, destinations: 6, themes: 4, summary: 1 }, name: 'holiday_text' },
);
HolidaySchema.index({ published: 1, isSample: 1, popularity: -1 });
HolidaySchema.index({ published: 1, createdAt: -1 });
