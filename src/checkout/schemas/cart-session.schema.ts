import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AdditionalDetails,
  AdditionalDetailsSchema,
  CustomerDetails,
  CustomerDetailsSchema,
  PickupDetails,
  PickupDetailsSchema,
  PriceLineDoc,
  PriceLineSchema,
} from '../../bookings/schemas/booking-parts.schema';
import { Money, MoneySchema } from '../../catalog/schemas/activity.schema';

export type CartSessionDocument = HydratedDocument<CartSession>;

export const CART_STATUSES = ['open', 'awaiting_payment', 'completed', 'expired'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

/** One activity in the cart. Holds capacity until the owning cart's `expiresAt`. */
@Schema({ _id: false })
export class CartItem {
  @Prop({ type: String, required: true })
  itemId: string;

  @Prop({ type: String, required: true })
  activitySlug: string;

  @Prop({ type: String, required: true })
  activityTitle: string;

  @Prop({ type: String, default: '' })
  image: string;

  @Prop({ type: String })
  locationName?: string;

  @Prop({ type: String, required: true })
  optionId: string;

  @Prop({ type: String, required: true })
  optionName: string;

  @Prop({ type: String, required: true })
  transferType: string;

  @Prop({ type: String })
  startTime?: string;

  @Prop({ type: Boolean, required: true })
  pickupRequired: boolean;

  @Prop({ type: Boolean, required: true })
  refundable: boolean;

  @Prop({ type: Date })
  freeCancellationUntil?: Date;

  /** Service day, YYYY-MM-DD (Asia/Dubai). */
  @Prop({ type: String, required: true })
  date: string;

  @Prop({ type: Number, required: true, min: 1 })
  adults: number;

  @Prop({ type: Number, required: true, min: 0 })
  children: number;

  @Prop({ type: [PriceLineSchema], default: [] })
  lines: PriceLineDoc[];

  @Prop({ type: MoneySchema, required: true })
  adultPrice: Money;

  @Prop({ type: MoneySchema, default: null })
  childPrice?: Money | null;

  // Minor units (fils). Recomputed on every cart change.
  @Prop({ type: Number, required: true, min: 0 })
  subtotalMinor: number;

  @Prop({ type: Number, default: 0, min: 0 })
  discountMinor: number;

  @Prop({ type: Number, default: 0, min: 0 })
  taxMinor: number;

  @Prop({ type: Number, required: true, min: 0 })
  totalMinor: number;

  @Prop({ type: PickupDetailsSchema })
  pickup?: PickupDetails;

  @Prop({ type: AdditionalDetailsSchema })
  additional?: AdditionalDetails;
}

export const CartItemSchema = SchemaFactory.createForClass(CartItem);

/** The user's cart ("session"): at most one active (open or awaiting payment) per user. */
@Schema({ timestamps: true, collection: 'checkout_carts', optimisticConcurrency: true })
export class CartSession {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: CART_STATUSES, default: 'open', index: true })
  status: CartStatus;

  /** True while open or awaiting payment; backs the one-active-cart-per-user unique index. */
  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: [CartItemSchema], default: [] })
  items: CartItem[];

  @Prop({ type: CustomerDetailsSchema })
  customer?: CustomerDetails;

  @Prop({ type: String })
  promoCode?: string;

  @Prop({ type: Number, default: 0 })
  subtotalMinor: number;

  @Prop({ type: Number, default: 0 })
  discountMinor: number;

  @Prop({ type: Number, default: 0 })
  taxMinor: number;

  @Prop({ type: Number, default: 0 })
  totalMinor: number;

  @Prop({ type: String })
  orderReference?: string;

  /** Set when expiry dropped the items; the next cart read reports them once (`Session.expired`). */
  @Prop({ type: Boolean, default: false })
  expiredNoticePending: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const CartSessionSchema = SchemaFactory.createForClass(CartSession);
CartSessionSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { active: true } });
CartSessionSchema.index({ status: 1, expiresAt: 1 });
CartSessionSchema.index({ userId: 1, createdAt: -1 });
