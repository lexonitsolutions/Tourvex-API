import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SellerRegistrationDocument = HydratedDocument<SellerRegistration>;

/** A legal entity that issues invoices (its tax registration, address and bank details). */
@Schema({ timestamps: true, collection: 'seller_registrations' })
export class SellerRegistration {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, uppercase: true, trim: true, minlength: 2, maxlength: 2 })
  country: string;

  @Prop({ type: String, required: true, trim: true })
  legalName: string;

  /** TRN / GSTIN / VAT number. */
  @Prop({ type: String, default: '', trim: true })
  registrationNumber: string;

  @Prop({ type: String, default: '' })
  address: string;

  @Prop({ type: String, default: '' })
  state?: string;

  /** India: 2-digit GST state code. */
  @Prop({ type: String, default: '' })
  stateCode?: string;

  @Prop({ type: String, default: '' })
  email: string;

  @Prop({ type: String, default: '' })
  phone: string;

  @Prop({ type: String, default: '' })
  website: string;

  @Prop({ type: String, default: '' })
  bankDetails?: string;

  /** Exactly one registration is the default (used when none matches the tax country). */
  @Prop({ type: Boolean, default: false })
  isDefault: boolean;

  @Prop({ type: Boolean, default: true })
  active: boolean;

  /**
   * Which counters this seller's invoice numbers use. `legacy` = the counters that existed before regimes (so the
   * original UAE sequence continues); everything else = the registration's own id. Set once, never edited.
   */
  @Prop({ type: String, required: true })
  numberingScope: string;

  createdAt: Date;
  updatedAt: Date;
}

export const SellerRegistrationSchema = SchemaFactory.createForClass(SellerRegistration);
// Exactly one default.
SellerRegistrationSchema.index({ isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });
// One active registration per country, so a number series never has two issuers.
SellerRegistrationSchema.index({ country: 1 }, { unique: true, partialFilterExpression: { active: true } });
