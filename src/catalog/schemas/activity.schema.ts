import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockStatus, StockStatusSchema } from '../../stock/schemas/stock-status.schema';

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
export class ActivityVideo {
  @Prop({ type: String, required: true, trim: true })
  url: string;
}

export const ActivityVideoSchema = SchemaFactory.createForClass(ActivityVideo);

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

@Schema({ _id: false })
export class ActivityItineraryItem {
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: true, trim: true })
  description: string;

  @Prop({ type: String, trim: true })
  duration?: string;

  @Prop({ type: String, trim: true })
  imageUrl?: string;
}

export const ActivityItineraryItemSchema = SchemaFactory.createForClass(ActivityItineraryItem);

@Schema({ _id: false })
export class ActivityFaq {
  @Prop({ type: String, required: true, trim: true })
  question: string;

  @Prop({ type: String, required: true, trim: true })
  answer: string;
}

export const ActivityFaqSchema = SchemaFactory.createForClass(ActivityFaq);

@Schema({ _id: false })
export class ActivityContentSection {
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, trim: true })
  body?: string;

  @Prop({ type: [String], default: [] })
  items?: string[];
}

export const ActivityContentSectionSchema = SchemaFactory.createForClass(ActivityContentSection);

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

  @Prop({ type: Boolean, default: true })
  allowAddToCart: boolean;

  // Detail fields (absent until real or sample details are loaded).
  @Prop({ type: [GalleryImageSchema], default: undefined })
  gallery?: GalleryImage[];

  @Prop({ type: ActivityVideoSchema })
  heroVideo?: ActivityVideo;

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

  @Prop({ type: [String], default: undefined })
  whatToBring?: string[];

  @Prop({ type: [String], default: undefined })
  cancellationPolicy?: string[];

  @Prop({ type: [ActivityItineraryItemSchema], default: undefined })
  itinerary?: ActivityItineraryItem[];

  @Prop({ type: [ActivityFaqSchema], default: undefined })
  faqs?: ActivityFaq[];

  @Prop({ type: [ActivityContentSectionSchema], default: undefined })
  contentSections?: ActivityContentSection[];

  @Prop({ type: ActivityLocationSchema })
  location?: ActivityLocation;

  @Prop({ type: String })
  duration?: string;

  @Prop({ type: [ActivityOptionSchema], default: undefined })
  options?: ActivityOption[];

  /** True when the detail text/options are ORIGINAL SAMPLE content (hidden in production by default). */
  @Prop({ type: Boolean })
  detailsAreSample?: boolean;

  /** Denormalised availability flags (see StockService); absent until the first refresh. */
  @Prop({ type: StockStatusSchema })
  stockStatus?: StockStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ 'title.en': 'text', 'title.ar': 'text', destinations: 'text' });
