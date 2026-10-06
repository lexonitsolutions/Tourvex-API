import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ENQUIRY_STATUSES } from '../../visas/visas.utils';

export type HolidayEnquiryDocument = HydratedDocument<HolidayEnquiry>;

/** Lead capture only: personal data is limited to what the traveller submits. Never log it. */
@Schema({ timestamps: true, collection: 'holiday_enquiries' })
export class HolidayEnquiry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  holidayId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  holidaySlug: string;

  @Prop({ type: String, required: true, unique: true })
  reference: string;

  @Prop({ type: String, required: true, trim: true })
  fullName: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ type: String, required: true, trim: true })
  phone: string;

  @Prop({ type: Number, required: true, min: 1, max: 20, default: 1 })
  travelers: number;

  @Prop({ type: Date })
  travelDate?: Date;

  @Prop({ type: Number, min: 0 })
  totalAmount?: number;

  @Prop({ type: String, trim: true, uppercase: true, default: 'AED' })
  currency: string;

  @Prop({ type: String, trim: true })
  message?: string;

  @Prop({ type: String, trim: true })
  nationality?: string;

  @Prop({ type: Number, min: 0, max: 20 })
  adults?: number;

  @Prop({ type: Number, min: 0, max: 20 })
  children?: number;

  @Prop({ type: Boolean, default: false })
  marketingOptOut?: boolean;

  @Prop({ type: Date, required: true })
  consentAt: Date;

  /** Local user id, set only when a valid Clerk session token accompanied the request. */
  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  @Prop({ type: String, enum: ENQUIRY_STATUSES, default: 'new' })
  status: string;

  @Prop({ type: String, trim: true })
  note?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const HolidayEnquirySchema = SchemaFactory.createForClass(HolidayEnquiry);
HolidayEnquirySchema.index({ status: 1, createdAt: -1 });
