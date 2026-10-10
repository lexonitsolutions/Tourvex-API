import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** The single tax settings document (`key: 'tax'`). */
@Schema({ timestamps: true, collection: 'tax_settings' })
export class TaxSetting {
  @Prop({ type: String, required: true, unique: true, default: 'tax' })
  key: string;

  /** Regime used when the service country has none. */
  @Prop({ type: String, required: true, uppercase: true, minlength: 2, maxlength: 2, default: 'AE' })
  defaultCountry: string;

  /** Percent used when no regime exists at all. */
  @Prop({ type: Number, required: true, min: 0, max: 100, default: 5 })
  defaultRateFallbackPercent: number;

  createdAt: Date;
  updatedAt: Date;
}

export const TaxSettingSchema = SchemaFactory.createForClass(TaxSetting);
