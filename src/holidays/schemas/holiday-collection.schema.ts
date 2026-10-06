import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HolidayCollectionDocument = HydratedDocument<HolidayCollection>;

@Schema({ timestamps: true, collection: 'holiday_collections' })
export class HolidayCollection {
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

export const HolidayCollectionSchema = SchemaFactory.createForClass(HolidayCollection);
HolidayCollectionSchema.index({ published: 1, order: 1 });
