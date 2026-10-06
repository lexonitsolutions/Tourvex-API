import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SiteSettingDocument = HydratedDocument<SiteSetting>;

/** One document per settings group (`general`, `commerce`, `notifications`, `homepage`). */
@Schema({ timestamps: true, collection: 'site_settings' })
export class SiteSetting {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  group: string;

  /** The validated group values, replaced as a whole on every update. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  values: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  @Prop({ type: String })
  updatedByEmail?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const SiteSettingSchema = SchemaFactory.createForClass(SiteSetting);
