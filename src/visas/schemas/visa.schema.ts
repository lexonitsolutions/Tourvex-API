import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { VISA_ENTRIES, VISA_KINDS } from '../visas.utils';

export type VisaDocument = HydratedDocument<Visa>;

@Schema({ _id: false })
export class VisaMoney {
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;
}
export const VisaMoneySchema = SchemaFactory.createForClass(VisaMoney);

@Schema({ _id: false })
export class VisaStep {
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: true, trim: true })
  description: string;
}
export const VisaStepSchema = SchemaFactory.createForClass(VisaStep);

@Schema({ _id: false })
export class VisaFaq {
  @Prop({ type: String, required: true, trim: true })
  question: string;

  @Prop({ type: String, required: true, trim: true })
  answer: string;
}
export const VisaFaqSchema = SchemaFactory.createForClass(VisaFaq);

@Schema({ _id: false })
export class VisaGalleryImage {
  @Prop({ type: String, required: true, trim: true })
  url: string;

  @Prop({ type: String, default: '', trim: true })
  alt: string;
}
export const VisaGalleryImageSchema = SchemaFactory.createForClass(VisaGalleryImage);

@Schema({ timestamps: true, collection: 'visas' })
export class Visa {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, trim: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  country: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true, minlength: 2, maxlength: 2 })
  countryCode: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: true, enum: VISA_KINDS, index: true })
  kind: string;

  @Prop({ type: String, default: '', trim: true })
  summary: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: VisaMoneySchema, default: null })
  startingPrice?: VisaMoney | null;

  @Prop({ type: String, default: '', trim: true })
  processing: string;

  @Prop({ type: String, default: '', trim: true })
  validity: string;

  @Prop({ type: String, enum: VISA_ENTRIES, default: 'varies' })
  entries: string;

  @Prop({ type: String, default: '', trim: true })
  stay: string;

  @Prop({ type: [String], default: [] })
  highlights: string[];

  @Prop({ type: [String], default: [] })
  requirements: string[];

  @Prop({ type: [String], default: [] })
  documents: string[];

  @Prop({ type: [VisaStepSchema], default: [] })
  steps: VisaStep[];

  @Prop({ type: [VisaFaqSchema], default: [] })
  faqs: VisaFaq[];

  @Prop({ type: [VisaGalleryImageSchema], default: [] })
  gallery: VisaGalleryImage[];

  @Prop({ type: String, default: '', trim: true })
  notes: string;

  @Prop({ type: [String], default: [], index: true })
  sections: string[];

  @Prop({ type: Number, default: 0 })
  popularity: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;

  @Prop({ type: Boolean, default: false })
  isSample: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const VisaSchema = SchemaFactory.createForClass(Visa);
VisaSchema.index(
  { country: 'text', title: 'text', summary: 'text' },
  { weights: { country: 10, title: 8, summary: 1 }, name: 'visa_text' },
);
VisaSchema.index({ published: 1, isSample: 1, popularity: -1 });
VisaSchema.index({ published: 1, kind: 1, popularity: -1 });
