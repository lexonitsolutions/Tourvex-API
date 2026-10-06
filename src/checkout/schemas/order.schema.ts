import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrderDocument = HydratedDocument<Order>;

export const ORDER_STATUSES = ['pending_payment', 'paid', 'expired', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** One payment for a whole cart: one Booking per cart item, one PaymentIntent for the total. */
@Schema({ timestamps: true, collection: 'orders' })
export class Order {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  orderReference: string;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, ref: 'CartSession' })
  cartId: Types.ObjectId;

  @Prop({ type: String, enum: ORDER_STATUSES, default: 'pending_payment', index: true })
  status: OrderStatus;

  /** True while pending_payment or paid; at most one such order per cart. */
  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: [String], default: [] })
  bookingReferences: string[];

  @Prop({ type: Number, required: true })
  subtotalMinor: number;

  @Prop({ type: Number, default: 0 })
  discountMinor: number;

  @Prop({ type: Number, default: 0 })
  taxMinor: number;

  @Prop({ type: Number, required: true })
  totalMinor: number;

  @Prop({ type: String, required: true, default: 'AED' })
  currency: string;

  @Prop({ type: String })
  promoCode?: string;

  /** Set once when the promo's usedCount was incremented for this order. */
  @Prop({ type: Boolean, default: false })
  promoCounted: boolean;

  @Prop({ type: String, enum: ['stripe', 'mock'] })
  paymentMode?: string;

  @Prop({ type: String })
  paymentIntentId?: string;

  @Prop({ type: String })
  paymentReference?: string;

  @Prop({ type: Date })
  paidAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ cartId: 1 }, { unique: true, partialFilterExpression: { active: true } });
