import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ENQUIRY_STATUSES } from '../events.utils';

export type EventEnquiryDocument = HydratedDocument<EventEnquiry>;

/** Lead capture only: personal data is limited to what the visitor submits. Never log it. */
@Schema({ timestamps: true, collection: 'event_enquiries' })
export class EventEnquiry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  eventId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  eventSlug: string;

  @Prop({ type: String, required: true, unique: true })
  reference: string;

  @Prop({ type: String, required: true, trim: true })
  fullName: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ type: String, required: true, trim: true })
  phone: string;

  @Prop({ type: Number, required: true, min: 1, max: 20 })
  tickets: number;

  @Prop({ type: String, trim: true })
  ticketType?: string;

  @Prop({ type: Types.ObjectId })
  sessionId?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  message?: string;

  @Prop({ type: Date, required: true })
  consentAt: Date;

  /** Local user id, set only when a valid Clerk session token accompanied the request. */
  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  /** `booked` is set only by the stock module when staff confirm the enquiry into a booking. */
  @Prop({ type: String, enum: [...ENQUIRY_STATUSES, 'booked'], default: 'new' })
  status: string;

  /** Booking created from this enquiry (stock module). */
  @Prop({ type: String })
  bookingReference?: string;

  @Prop({ type: Date })
  bookedAt?: Date;

  @Prop({ type: String, trim: true })
  note?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const EventEnquirySchema = SchemaFactory.createForClass(EventEnquiry);
EventEnquirySchema.index({ status: 1, createdAt: -1 });
