import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ENQUIRY_STATUSES } from '../cruises.utils';

export type CruiseEnquiryDocument = HydratedDocument<CruiseEnquiry>;

/** Lead capture only: personal data is limited to what the traveller submits. Never log it. */
@Schema({ timestamps: true, collection: 'cruise_enquiries' })
export class CruiseEnquiry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  cruiseId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  cruiseSlug: string;

  @Prop({ type: String, required: true, unique: true })
  reference: string;

  @Prop({ type: String, required: true, trim: true })
  fullName: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ type: String, required: true, trim: true })
  phone: string;

  @Prop({ type: String, required: true, trim: true })
  nationality: string;

  @Prop({ type: Number, required: true, min: 1, max: 10 })
  adults: number;

  @Prop({ type: Number, required: true, min: 0, max: 10 })
  children: number;

  @Prop({ type: Date })
  departureDate?: Date;

  @Prop({ type: String, trim: true })
  cabinType?: string;

  @Prop({ type: Number, required: true, min: 1, max: 10, default: 1 })
  cabins: number;

  /** Immutable package facts captured when the request was submitted. */
  @Prop({ type: String, required: true, trim: true })
  departurePort: string;

  @Prop({ type: Number, required: true, min: 1 })
  nights: number;

  @Prop({ type: String, trim: true })
  specialRequirements?: string;

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

export const CruiseEnquirySchema = SchemaFactory.createForClass(CruiseEnquiry);
CruiseEnquirySchema.index({ status: 1, createdAt: -1 });
