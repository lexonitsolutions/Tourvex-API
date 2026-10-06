import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ActivityDocument = HydratedDocument<Activity>;

@Schema({ _id: false })
export class LocalizedText {
  @Prop({ type: String, required: true, trim: true })
  en: string;

  @Prop({ type: String, trim: true })
  ar?: string;
}

export const LocalizedTextSchema = SchemaFactory.createForClass(LocalizedText);

@Schema({ _id: false })
export class Money {
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;
}

export const MoneySchema = SchemaFactory.createForClass(Money);

@Schema({ _id: false })
export class GalleryImage {
  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: true })
  alt: string;
}

export const GalleryImageSchema = SchemaFactory.createForClass(GalleryImage);

@Schema({ _id: false })
export class ActivityLocation {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  address: string;

  @Prop({ type: Number })
  lat?: number;

  @Prop({ type: Number })
  lng?: number;
}

export const ActivityLocationSchema = SchemaFactory.createForClass(ActivityLocation);

/** A bookable variant of an activity. Option prices are the authoritative per-pax prices (AED). */
@Schema({ _id: false })
export class ActivityOption {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true, enum: ['sharing', 'private', 'none'] })
  transferType: string;

  @Prop({ type: String })
  startTime?: string;

  @Prop({ type: String })
  durationLabel?: string;

  @Prop({ type: MoneySchema, required: true })
  adultPrice: Money;

  @Prop({ type: MoneySchema, default: null })
  childPrice?: Money | null;

  @Prop({ type: String })
  childAgeRange?: string;

  @Prop({ type: Number, required: true, min: 1 })
  minPax: number;

  @Prop({ type: Number, required: true, min: 1 })
  maxPax: number;

  @Prop({ type: Boolean, required: true, default: false })
  pickupRequired: boolean;

  @Prop({ type: Number, default: null })
  freeCancellationHours?: number | null;

  @Prop({ type: Boolean, required: true, default: false })
  refundable: boolean;

  @Prop({ type: [Number], default: [0, 1, 2, 3, 4, 5, 6] })
  operatingWeekdays: number[];

  @Prop({ type: [String], default: [] })
  blackoutDates?: string[];

  @Prop({ type: Number, default: null })
  dailyCapacity?: number | null;

  @Prop({ type: Number, default: 0 })
  cutoffHours?: number;
}

export const ActivityOptionSchema = SchemaFactory.createForClass(ActivityOption);

@Schema({ timestamps: true, collection: 'activities' })
export class Activity {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  slug: string;

  @Prop({ type: Number, index: true, sparse: true })
  legacyId?: number;

  @Prop({ type: LocalizedTextSchema, required: true })
  title: LocalizedText;

  @Prop({ type: LocalizedTextSchema })
  summary?: LocalizedText;

  @Prop({ type: [String], default: [], index: true })
  destinations: string[];

  @Prop({ type: [String], default: [], index: true })
  categories: string[];

  @Prop({ type: [String], default: [] })
  tripTypes: string[];

  @Prop({ type: [String], default: [] })
  difficulty: string[];

  @Prop({ type: MoneySchema })
  price?: Money;

  @Prop({ type: MoneySchema })
  salePrice?: Money;

  @Prop({ type: Number })
  durationDays?: number;

  @Prop({ type: Number })
  durationNights?: number;

  @Prop({ type: String })
  imageUrl?: string;

  @Prop({ type: String })
  sourceUrl?: string;

  @Prop({ type: String, default: 'wordpress' })
  source: string;

  @Prop({ type: Boolean, default: true, index: true })
  published: boolean;

  // Detail fields (absent until real or sample details are loaded).
  @Prop({ type: [GalleryImageSchema], default: undefined })
  gallery?: GalleryImage[];

  @Prop({ type: String })
  operatingHours?: string;

  @Prop({ type: Boolean })
  instantConfirmation?: boolean;

  @Prop({ type: Boolean })
  mobileVoucher?: boolean;

  @Prop({ type: Number })
  freeCancellationHours?: number | null;

  @Prop({ type: [String], default: undefined })
  languages?: string[];

  @Prop({ type: String })
  description?: string;

  @Prop({ type: [String], default: undefined })
  highlights?: string[];

  @Prop({ type: [String], default: undefined })
  inclusions?: string[];

  @Prop({ type: [String], default: undefined })
  exclusions?: string[];

  @Prop({ type: [String], default: undefined })
  howToRedeem?: string[];

  @Prop({ type: [String], default: undefined })
  importantInfo?: string[];

  @Prop({ type: ActivityLocationSchema })
  location?: ActivityLocation;

  @Prop({ type: String })
  duration?: string;

  @Prop({ type: [ActivityOptionSchema], default: undefined })
  options?: ActivityOption[];

  /** True when the detail text/options are ORIGINAL SAMPLE content (hidden in production by default). */
  @Prop({ type: Boolean })
  detailsAreSample?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ 'title.en': 'text', 'title.ar': 'text', destinations: 'text' });
