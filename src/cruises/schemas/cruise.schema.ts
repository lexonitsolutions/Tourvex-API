import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockStatus, StockStatusSchema } from '../../stock/schemas/stock-status.schema';
import { ITINERARY_TYPES } from '../cruises.utils';

export type CruiseDocument = HydratedDocument<Cruise>;

@Schema({ _id: false })
export class CruiseMoney {
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;
}
export const CruiseMoneySchema = SchemaFactory.createForClass(CruiseMoney);

@Schema({ _id: false })
export class CruiseImage {
  @Prop({ type: String, required: true, trim: true })
  url: string;

  @Prop({ type: String, required: true, trim: true })
  alt: string;
}
export const CruiseImageSchema = SchemaFactory.createForClass(CruiseImage);

@Schema({ _id: false })
export class CruiseStop {
  @Prop({ type: Number, required: true, min: 1 })
  day: number;

  @Prop({ type: String, required: true, trim: true })
  port: string;

  @Prop({ type: String, trim: true })
  country?: string;

  @Prop({ type: String, required: true, enum: ITINERARY_TYPES })
  type: string;

  @Prop({ type: String, default: '', trim: true })
  description: string;
}
export const CruiseStopSchema = SchemaFactory.createForClass(CruiseStop);

@Schema({ _id: false })
export class CruiseCabin {
  @Prop({ type: String, required: true, trim: true })
  type: string;

  @Prop({ type: String, default: '', trim: true })
  description: string;

  @Prop({ type: CruiseMoneySchema, default: null })
  fromPrice?: CruiseMoney | null;
}
export const CruiseCabinSchema = SchemaFactory.createForClass(CruiseCabin);

@Schema({ timestamps: true, collection: 'cruises' })
export class Cruise {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, trim: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '', trim: true })
  summary: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: String, required: true, trim: true })
  coverImage: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  cruiseLine: string;

  @Prop({ type: String, required: true, trim: true })
  shipName: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  departureCity: string;

  @Prop({ type: String, required: true, trim: true })
  departureCountry: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  region: string;

  @Prop({ type: Number, required: true, min: 1 })
  durationNights: number;

  @Prop({ type: Number, required: true, min: 1 })
  durationDays: number;

  /** UTC-midnight departure dates. The API only ever returns the upcoming ones. */
  @Prop({ type: [Date], default: [], index: true })
  departures: Date[];

  @Prop({ type: [CruiseStopSchema], default: [] })
  itinerary: CruiseStop[];

  @Prop({ type: [CruiseCabinSchema], default: [] })
  cabins: CruiseCabin[];

  @Prop({ type: [CruiseImageSchema], default: [] })
  images: CruiseImage[];

  @Prop({ type: [String], default: [] })
  highlights: string[];

  @Prop({ type: [String], default: [] })
  inclusions: string[];

  @Prop({ type: [String], default: [] })
  exclusions: string[];

  @Prop({ type: String, default: '', trim: true })
  notes: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  /** Fallback "from" fare when no cabin has one. */
  @Prop({ type: CruiseMoneySchema, default: null })
  price?: CruiseMoney | null;

  @Prop({ type: Number, default: 0 })
  popularity: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;

  @Prop({ type: Boolean, default: false })
  allowAddToCart: boolean;

  @Prop({ type: Boolean, default: false })
  isSample: boolean;

  /** Denormalised availability flags (see StockService); absent until the first refresh. */
  @Prop({ type: StockStatusSchema })
  stockStatus?: StockStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const CruiseSchema = SchemaFactory.createForClass(Cruise);
CruiseSchema.index(
  { title: 'text', shipName: 'text', cruiseLine: 'text', 'itinerary.port': 'text' },
  {
    weights: { title: 10, shipName: 5, cruiseLine: 5, 'itinerary.port': 3 },
    name: 'cruise_text',
  },
);
CruiseSchema.index({ published: 1, isSample: 1, popularity: -1 });
CruiseSchema.index({ published: 1, departureCity: 1, popularity: -1 });
