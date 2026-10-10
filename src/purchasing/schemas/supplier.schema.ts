import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierDocument = HydratedDocument<Supplier>;

/** A company stock is bought from (see docs/BILLING_API.md). Not related to the activity-supplier adapters in `src/suppliers`. */
@Schema({ timestamps: true, collection: 'suppliers' })
export class Supplier {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 160 })
  name: string;

  /** Lower-cased `name`: the case-insensitive unique key. */
  @Prop({ type: String, required: true })
  nameKey: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 200 })
  legalName: string;

  /** ISO 3166-1 alpha-2. */
  @Prop({ type: String, required: true, uppercase: true, minlength: 2, maxlength: 2 })
  country: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 60 })
  registrationNumber: string;

  @Prop({ type: String, default: '', trim: true, lowercase: true, maxlength: 200 })
  email: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 40 })
  phone: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 500 })
  address: string;

  @Prop({ type: Number, default: 0, min: 0, max: 365 })
  paymentTermsDays: number;

  @Prop({ type: String, default: 'AED', uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;

  @Prop({ type: String, default: '', maxlength: 2000 })
  notes: string;

  @Prop({ type: Boolean, default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);
SupplierSchema.index({ nameKey: 1 }, { unique: true });
SupplierSchema.index({ active: 1, name: 1 });
