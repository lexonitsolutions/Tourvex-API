import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PartnerDocument = HydratedDocument<Partner>;

@Schema({ timestamps: true, collection: 'partners' })
export class Partner {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 2, maxlength: 80 })
  name: string;

  @Prop({ type: String, default: null, trim: true })
  logo: string | null;

  @Prop({ type: String, default: null, trim: true })
  href: string | null;

  @Prop({ type: String, required: true, trim: true, minlength: 2, maxlength: 40 })
  category: string;

  @Prop({ type: [String], default: ['home', 'activities'] })
  placements: string[];

  @Prop({ type: Number, default: 0 })
  order: number;

  @Prop({ type: Boolean, default: true })
  published: boolean;

  @Prop({ type: Boolean, default: false })
  isSample: boolean;
}

export const PartnerSchema = SchemaFactory.createForClass(Partner);
// Case-insensitive uniqueness: "Harbour Aquarium" and "harbour aquarium" are the same partner.
PartnerSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
PartnerSchema.index({ published: 1, order: 1, name: 1 });
