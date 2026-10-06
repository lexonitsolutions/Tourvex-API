import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ServiceType } from '../../../common/enums/service-type.enum';

export type InventoryDocument = HydratedDocument<Inventory>;

@Schema({ timestamps: true, collection: 'inventory' })
export class Inventory {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  sku: string;

  @Prop({ type: String, required: true, enum: ServiceType, index: true })
  serviceType: ServiceType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: Number, required: true, min: 0 })
  capacity: number;

  @Prop({ type: Number, required: true, min: 0 })
  available: number;

  @Prop({ type: Number, default: 0, min: 0 })
  reserved: number;

  @Prop({ type: Number, default: 0, min: 0 })
  sold: number;

  @Prop({ type: Number, required: true, min: 0 })
  unitCost: number;

  @Prop({ type: Number, required: true, min: 0 })
  retailPrice: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency: string;

  @Prop({ type: Date, index: true })
  serviceDate?: Date;

  @Prop({ type: Boolean, default: true, index: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const InventorySchema = SchemaFactory.createForClass(Inventory);
InventorySchema.index({ serviceType: 1, serviceDate: 1, active: 1 });
