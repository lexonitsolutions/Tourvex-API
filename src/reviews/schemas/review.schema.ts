import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

export const REVIEW_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Only created by a customer with a confirmed, past booking of the activity; moderated by staff. */
@Schema({ timestamps: true, collection: 'activity_reviews' })
export class Review {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  activitySlug: string;

  /** One review per booking. */
  @Prop({ type: Types.ObjectId, required: true, unique: true, ref: 'Booking' })
  bookingId: Types.ObjectId;

  @Prop({ type: String, required: true })
  bookingReference: string;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User', index: true })
  userId: Types.ObjectId;

  /** "Alisa P." computed at creation; no e-mail or phone is ever stored on a review. */
  @Prop({ type: String, required: true })
  displayName: string;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  title: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 2000 })
  body: string;

  /** No upload flow yet; reserved for moderated image URLs added by staff. */
  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ type: String, enum: REVIEW_STATUSES, default: 'pending', index: true })
  status: ReviewStatus;

  @Prop({ type: Date })
  moderatedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  moderatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ activitySlug: 1, status: 1, createdAt: -1 });
