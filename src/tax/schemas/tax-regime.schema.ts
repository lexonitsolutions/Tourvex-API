import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TaxRegimeDocument = HydratedDocument<TaxRegime>;

export const TAX_MODELS = ['single', 'india_gst'] as const;
export const QR_KINDS = ['none', 'zatca'] as const;

@Schema({ _id: false })
export class TaxRateDoc {
  @Prop({ type: String, required: true })
  code: string;

  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  percent: number;

  @Prop({ type: Boolean, default: false })
  isDefault: boolean;
}
export const TaxRateSchema = SchemaFactory.createForClass(TaxRateDoc);

@Schema({ _id: false })
export class ServiceCodeDoc {
  /** 'SAC' or 'HSN'. */
  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: String, required: true })
  value: string;

  @Prop({ type: String, default: '' })
  description: string;
}
export const ServiceCodeSchema = SchemaFactory.createForClass(ServiceCodeDoc);

@Schema({ _id: false })
export class NumberingDoc {
  @Prop({ type: String, required: true, default: 'INV' })
  prefix: string;

  @Prop({ type: String, required: true, default: 'CN' })
  creditPrefix: string;

  @Prop({ type: Boolean, default: false })
  includeCountry: boolean;

  @Prop({ type: Number, enum: [2, 4], default: 4 })
  yearDigits: 2 | 4;

  @Prop({ type: Number, min: 4, max: 8, default: 6 })
  sequenceDigits: number;

  @Prop({ type: Number, min: 8, max: 40, default: null })
  maxLength?: number | null;
}
export const NumberingSchema = SchemaFactory.createForClass(NumberingDoc);

/** Tax rules of one country (admin editable; seeded once, never overwritten by the seed). */
@Schema({ timestamps: true, collection: 'tax_regimes' })
export class TaxRegime {
  _id: Types.ObjectId;

  /** ISO 3166-1 alpha-2, upper case. Unique among ACTIVE regimes. */
  @Prop({ type: String, required: true, uppercase: true, trim: true, minlength: 2, maxlength: 2 })
  country: string;

  @Prop({ type: String, required: true, trim: true })
  countryName: string;

  @Prop({ type: String, required: true, trim: true })
  taxName: string;

  @Prop({ type: String, required: true, trim: true })
  invoiceTitle: string;

  @Prop({ type: String, required: true, trim: true })
  registrationLabel: string;

  @Prop({ type: String, enum: TAX_MODELS, required: true, default: 'single' })
  model: 'single' | 'india_gst';

  @Prop({ type: [TaxRateSchema], default: [] })
  rates: TaxRateDoc[];

  @Prop({ type: ServiceCodeSchema })
  serviceCode?: ServiceCodeDoc;

  @Prop({ type: Boolean, default: false })
  pricesIncludeTax: boolean;

  @Prop({ type: NumberingSchema, default: () => ({}) })
  numbering: NumberingDoc;

  @Prop({ type: String, default: '' })
  invoiceNotes?: string;

  @Prop({ type: String, enum: QR_KINDS, default: 'none' })
  qr: 'none' | 'zatca';

  @Prop({ type: Boolean, default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const TaxRegimeSchema = SchemaFactory.createForClass(TaxRegime);
// One active regime per country (inactive ones may repeat).
TaxRegimeSchema.index({ country: 1 }, { unique: true, partialFilterExpression: { active: true } });
