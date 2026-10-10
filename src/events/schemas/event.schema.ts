import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockStatus, StockStatusSchema } from '../../stock/schemas/stock-status.schema';
import { EVENT_CATEGORIES } from '../events.utils';

export type EventDocument = HydratedDocument<Event>;

@Schema({ _id: false })
export class EventMoney {
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;
}
export const EventMoneySchema = SchemaFactory.createForClass(EventMoney);

@Schema({ _id: false })
export class EventImage {
  @Prop({ type: String, required: true, trim: true })
  url: string;

  @Prop({ type: String, required: true, trim: true })
  alt: string;
}
export const EventImageSchema = SchemaFactory.createForClass(EventImage);

/** Keeps its own `_id`: that is the session id an enquiry refers to. */
@Schema()
export class EventSession {
  _id: Types.ObjectId;

  @Prop({ type: Date, required: true, index: true })
  startsAt: Date;

  @Prop({ type: Date })
  doorsOpenAt?: Date;
}
export const EventSessionSchema = SchemaFactory.createForClass(EventSession);

@Schema({ _id: false })
export class EventTicketType {
  @Prop({ type: String, required: true, trim: true })
  type: string;

  @Prop({ type: String, default: '', trim: true })
  description: string;

  @Prop({ type: EventMoneySchema, default: null })
  price?: EventMoney | null;
}
export const EventTicketTypeSchema = SchemaFactory.createForClass(EventTicketType);

@Schema({ timestamps: true, collection: 'events' })
export class Event {
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

  @Prop({ type: String, required: true, enum: EVENT_CATEGORIES, index: true })
  category: string;

  @Prop({ type: String, required: true, trim: true })
  venue: string;

  @Prop({ type: String, default: '', trim: true })
  venueAddress: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  city: string;

  @Prop({ type: String, required: true, trim: true })
  country: string;

  @Prop({ type: Number, min: 1, default: null })
  durationMinutes?: number | null;

  /** The API only ever returns the upcoming ones. */
  @Prop({ type: [EventSessionSchema], default: [] })
  sessions: EventSession[];

  @Prop({ type: [EventTicketTypeSchema], default: [] })
  ticketTypes: EventTicketType[];

  @Prop({ type: [EventImageSchema], default: [] })
  images: EventImage[];

  @Prop({ type: [String], default: [] })
  highlights: string[];

  @Prop({ type: [String], default: [] })
  inclusions: string[];

  @Prop({ type: [String], default: [] })
  exclusions: string[];

  @Prop({ type: String, default: '', trim: true })
  ageGuidance: string;

  @Prop({ type: String, default: '', trim: true })
  notes: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  /** Fallback "from" price when no ticket type has one. */
  @Prop({ type: EventMoneySchema, default: null })
  price?: EventMoney | null;

  @Prop({ type: Number, default: 0 })
  popularity: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;

  @Prop({ type: Boolean, default: false })
  isSample: boolean;

  /** Denormalised availability flags (see StockService); absent until the first refresh. */
  @Prop({ type: StockStatusSchema })
  stockStatus?: StockStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index(
  { title: 'text', venue: 'text', city: 'text', tags: 'text' },
  { weights: { title: 10, venue: 5, city: 5, tags: 3 }, name: 'event_text' },
);
EventSchema.index({ published: 1, isSample: 1, popularity: -1 });
EventSchema.index({ published: 1, city: 1, popularity: -1 });
