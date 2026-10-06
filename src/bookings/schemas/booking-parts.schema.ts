import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Money, MoneySchema } from '../../catalog/schemas/activity.schema';

/** Sub-documents shared by cart items and bookings. No card data is ever stored here. */

@Schema({ _id: false })
export class PickupDetails {
  @Prop({ type: String, required: true, enum: ['now', 'later'] })
  mode: string;

  @Prop({ type: String, trim: true })
  locationName?: string;

  @Prop({ type: String, trim: true })
  address?: string;

  @Prop({ type: Number })
  lat?: number;

  @Prop({ type: Number })
  lng?: number;

  @Prop({ type: String, trim: true })
  notes?: string;
}

export const PickupDetailsSchema = SchemaFactory.createForClass(PickupDetails);

@Schema({ _id: false })
export class AdditionalDetails {
  @Prop({ type: [String], default: [] })
  leadTravellerNames: string[];

  @Prop({ type: String, trim: true })
  specialRequests?: string;

  @Prop({ type: String, trim: true })
  arrivalFlight?: string;

  @Prop({ type: String, trim: true })
  hotelName?: string;
}

export const AdditionalDetailsSchema = SchemaFactory.createForClass(AdditionalDetails);

@Schema({ _id: false })
export class CustomerDetails {
  @Prop({ type: String, required: true, trim: true })
  fullName: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ type: String, required: true })
  phoneCountryCode: string;

  @Prop({ type: String, required: true })
  phone: string;

  @Prop({ type: String, required: true, trim: true })
  nationality: string;

  @Prop({ type: Boolean, required: true, default: false })
  marketingOptOut: boolean;
}

export const CustomerDetailsSchema = SchemaFactory.createForClass(CustomerDetails);

@Schema({ _id: false })
export class PriceLineDoc {
  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: MoneySchema, required: true })
  unit: Money;

  @Prop({ type: Number, required: true })
  qty: number;

  @Prop({ type: MoneySchema, required: true })
  total: Money;
}

export const PriceLineSchema = SchemaFactory.createForClass(PriceLineDoc);
