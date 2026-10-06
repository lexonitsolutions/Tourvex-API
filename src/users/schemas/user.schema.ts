import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { Note, NoteSchema } from '../../common/notes/notes';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  Pending = 'pending',
  Active = 'active',
  Suspended = 'suspended',
}

export enum PartnerApplicationStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

@Schema({ _id: false })
export class PartnerApplication {
  @Prop({ type: String, enum: PartnerApplicationStatus, required: true })
  status: PartnerApplicationStatus;

  @Prop({ type: String, required: true, trim: true })
  companyName: string;

  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: String, trim: true })
  website?: string;

  @Prop({ type: String, trim: true })
  message?: string;

  @Prop({ type: Date, required: true })
  submittedAt: Date;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  reviewNote?: string;
}

export const PartnerApplicationSchema = SchemaFactory.createForClass(PartnerApplication);

/** Commercial terms agreed with an approved B2B partner (set in the admin, never by the partner). */
@Schema({ _id: false })
export class PartnerProfile {
  @Prop({ type: Number, min: 0, max: 100, default: 0 })
  discountPercent: number;

  @Prop({ type: Number, min: 0, max: 365, default: 0 })
  creditTermsDays: number;

  @Prop({ type: Number, min: 0 })
  creditLimitAed?: number;
}
export const PartnerProfileSchema = SchemaFactory.createForClass(PartnerProfile);

@Schema({ timestamps: true, collection: 'users' })
export class User {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  firstName: string;

  @Prop({ type: String, trim: true, default: '' })
  lastName: string;

  @Prop({ type: String, required: true, unique: true, lowercase: true, trim: true, index: true })
  email: string;

  /** Clerk user id (`user_...`). Absent until the person first signs in with Clerk. */
  @Prop({ type: String, unique: true, sparse: true })
  clerkUserId?: string;

  /** Legacy hash from the pre-Clerk password login. No longer written or read. */
  @Prop({ type: String, select: false })
  passwordHash?: string;

  @Prop({ type: [String], enum: Role, default: [Role.Customer], index: true })
  roles: Role[];

  @Prop({ type: String, enum: UserStatus, default: UserStatus.Active, index: true })
  status: UserStatus;

  /**
   * Admin kill switch (staff deactivation). Distinct from `status`; a user with `active: false`
   * gets 403 everywhere. Absent on legacy documents, which count as active.
   */
  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Partner', index: true })
  partnerId?: Types.ObjectId;

  /** Legacy hash from the pre-Clerk refresh tokens. No longer written or read. */
  @Prop({ type: String, select: false })
  refreshTokenHash?: string;

  @Prop({ type: PartnerApplicationSchema, default: null })
  partnerApplication?: PartnerApplication | null;

  @Prop({ type: String })
  preferredLocale?: string;

  @Prop({ type: String })
  preferredCurrency?: string;

  // CRM fields (customers admin). Absent on legacy documents.
  @Prop({ type: [String], default: [] })
  tags?: string[];

  @Prop({ type: Boolean, default: false })
  marketingOptOut?: boolean;

  @Prop({ type: [NoteSchema], default: [] })
  internalNotes?: Note[];

  @Prop({ type: PartnerProfileSchema })
  partnerProfile?: PartnerProfile;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
// Admin review queue: users with a pending/approved/rejected partner application.
UserSchema.index({ 'partnerApplication.status': 1 }, { sparse: true });
UserSchema.index({ createdAt: -1 });
