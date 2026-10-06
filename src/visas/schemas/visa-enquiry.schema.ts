import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ENQUIRY_STATUSES } from '../visas.utils';

export type VisaEnquiryDocument = HydratedDocument<VisaEnquiry>;

/** Lead capture only: personal data is limited to what the traveller submits. Never log it. */
@Schema({ timestamps: true, collection: 'visa_enquiries' })
export class VisaEnquiry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  visaId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  visaSlug: string;

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

  @Prop({ type: Number, required: true, min: 1, max: 20 })
  travellers: number;

  @Prop({ type: Date })
  travelDate?: Date;

  @Prop({ type: String, trim: true })
  message?: string;

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

export const VisaEnquirySchema = SchemaFactory.createForClass(VisaEnquiry);
VisaEnquirySchema.index({ status: 1, createdAt: -1 });
