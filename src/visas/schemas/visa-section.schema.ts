import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VisaSectionDocument = HydratedDocument<VisaSection>;

@Schema({ timestamps: true, collection: 'visa_sections' })
export class VisaSection {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, trim: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '', trim: true })
  subtitle: string;

  @Prop({ type: Number, default: 0 })
  order: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;
}

export const VisaSectionSchema = SchemaFactory.createForClass(VisaSection);
VisaSectionSchema.index({ published: 1, order: 1 });
