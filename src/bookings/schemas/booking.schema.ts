import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ServiceType } from '../../common/enums/service-type.enum';
import { Note, NoteSchema } from '../../common/notes/notes';
import {
  AdditionalDetails,
  AdditionalDetailsSchema,
  CustomerDetails,
  CustomerDetailsSchema,
  PickupDetails,
  PickupDetailsSchema,
  PriceLineDoc,
  PriceLineSchema,
} from './booking-parts.schema';

export type BookingDocument = HydratedDocument<Booking>;

/** Service types of bookings created from holiday, cruise and event enquiries (see the stock module). */
export const ENQUIRY_SERVICE_TYPES = ['holiday', 'cruise', 'event'] as const;
export type BookingServiceType = ServiceType | (typeof ENQUIRY_SERVICE_TYPES)[number];

export enum BookingStatus {
  PendingPayment = 'pending_payment',
  Confirmed = 'confirmed',
  CancellationRequested = 'cancellation_requested',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
  Expired = 'expired',
}

export const BOOKING_EVENT_TYPES = [
  'cancellation_requested',
  'cancellation_rejected',
  'cancelled',
  'refunded',
  'confirmed_manually',
  'confirmation_resent',
  'voucher_issued',
  'voucher_resent',
  'voucher_voided',
  'service_date_changed',
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

@Schema({ _id: false })
export class BookingEvent {
  @Prop({ type: String, required: true, enum: BOOKING_EVENT_TYPES })
  type: BookingEventType;

  @Prop({ type: Date, required: true })
  at: Date;

  /** Staff (or the customer, for a cancellation request) who caused the event. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop({ type: String })
  actorName?: string;

  @Prop({ type: String, maxlength: 500 })
  text?: string;
}

export const BookingEventSchema = SchemaFactory.createForClass(BookingEvent);

@Schema({ timestamps: true, collection: 'bookings' })
export class Booking {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Partner', index: true })
  partnerId?: Types.ObjectId;

  /** Inventory SKU of the legacy sku-based flow; absent for activity (cart/checkout) bookings. */
  @Prop({ type: String })
  sku?: string;

  @Prop({ type: String, required: true, enum: [...Object.values(ServiceType), ...ENQUIRY_SERVICE_TYPES] })
  serviceType: BookingServiceType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: Number, required: true, min: 0 })
  unitPrice: number;

  @Prop({ type: Number, required: true, min: 0 })
  subtotal: number;

  @Prop({ type: Number, default: 0, min: 0 })
  partnerDiscount: number;

  @Prop({ type: Number, default: 0, min: 0 })
  tax: number;

  @Prop({ type: Number, required: true, min: 0 })
  total: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, required: true, enum: BookingStatus, default: BookingStatus.PendingPayment, index: true })
  status: BookingStatus;

  @Prop({ type: Date })
  serviceDate?: Date;

  @Prop({ type: Boolean, default: true })
  refundable: boolean;

  @Prop({ type: Date })
  freeCancellationUntil?: Date;

  @Prop({ type: String, default: 'Free cancellation until 48 hours before service; otherwise non-refundable.' })
  cancellationPolicy: string;

  @Prop({ type: String })
  paymentReference?: string;

  @Prop({ type: String })
  supplierReference?: string;

  @Prop({ type: Date })
  confirmedAt?: Date;

  // Activity (cart/checkout) bookings. All optional so sku-based bookings are unaffected.
  @Prop({ type: String, index: true, sparse: true })
  orderReference?: string;

  /** Cart item the booking was created from; makes booking creation idempotent per order. */
  @Prop({ type: String })
  cartItemId?: string;

  @Prop({ type: String, index: true, sparse: true })
  activitySlug?: string;

  @Prop({ type: String })
  activityImage?: string;

  @Prop({ type: String })
  activityLocation?: string;

  @Prop({ type: String })
  optionId?: string;

  @Prop({ type: String })
  optionName?: string;

  @Prop({ type: String })
  transferType?: string;

  @Prop({ type: String })
  startTime?: string;

  /** Service calendar day (YYYY-MM-DD, Asia/Dubai); serviceDate is the same day at 00:00 UTC. */
  @Prop({ type: String })
  serviceDay?: string;

  @Prop({ type: Number, min: 0 })
  adults?: number;

  @Prop({ type: Number, min: 0 })
  children?: number;

  @Prop({ type: Boolean })
  pickupRequired?: boolean;

  @Prop({ type: PickupDetailsSchema })
  pickup?: PickupDetails;

  @Prop({ type: AdditionalDetailsSchema })
  additional?: AdditionalDetails;

  @Prop({ type: CustomerDetailsSchema })
  customer?: CustomerDetails;

  @Prop({ type: [PriceLineSchema], default: undefined })
  priceLines?: PriceLineDoc[];

  @Prop({ type: Number, min: 0 })
  discount?: number;

  @Prop({ type: String })
  promoCode?: string;

  // Stock identity (see the stock module). Activity bookings keep using activitySlug/optionId; bookings created
  // from a holiday/cruise/event enquiry carry these fields instead.
  @Prop({ type: String })
  stockProductType?: string;

  @Prop({ type: String })
  stockProductRef?: string;

  @Prop({ type: String })
  stockVariantId?: string;

  /**
   * Set when a confirmed booking is cancelled or fully refunded: true = its units went back to stock, false = they
   * stay used (cancelled after the cutoff). Cancelled/refunded bookings only count as sold while this is false.
   */
  @Prop({ type: Boolean })
  stockReleased?: boolean;

  // Tax snapshot taken when the booking is created (see docs/BILLING_API.md), so the invoice always matches what the
  // customer paid. Absent on bookings created before the tax module.
  @Prop({ type: String })
  taxCountry?: string;

  @Prop({ type: String })
  taxRegimeId?: string;

  @Prop({ type: String })
  taxName?: string;

  @Prop({ type: String })
  taxModel?: string;

  @Prop({ type: String })
  taxRateCode?: string;

  @Prop({ type: Number })
  taxPercent?: number;

  @Prop({ type: [Object], default: undefined })
  taxComponents?: { code: string; label: string; percent: number; taxableAmount: number; taxAmount: number }[];

  @Prop({ type: Boolean })
  taxPricesIncluded?: boolean;

  @Prop({ type: Object })
  taxPlaceOfSupply?: { country: string; state?: string; stateCode?: string };

  @Prop({ type: Object })
  taxServiceCode?: { label: string; value: string; description?: string };

  @Prop({ type: String })
  taxSellerId?: string;

  @Prop({ type: Boolean })
  taxFallback?: boolean;

  /** Set when staff chose the tax when confirming an enquiry. */
  @Prop({ type: Object })
  taxOverride?: {
    country?: string;
    rateCode?: string;
    placeOfSupplyState?: string;
    placeOfSupplyStateCode?: string;
    buyerRegistrationNumber?: string;
    reason: string;
    by: string;
    at: Date;
  };

  /** Buyer details staff typed in the enquiry confirm; they win over the customer details on the invoice. */
  @Prop({ type: Object })
  invoiceBuyer?: {
    name?: string;
    address?: string;
    country?: string;
    state?: string;
    stateCode?: string;
    registrationNumber?: string;
  };

  /** While pending_payment, the booking counts against capacity until this instant. */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  // Operations (admin) fields. All optional so existing documents keep working.

  /** Total refunded so far (mirrors the `refunds` ledger); never above `total`. */
  @Prop({ type: Number, min: 0 })
  refundedAmount?: number;

  /**
   * Supplier cost snapshot taken when the booking is confirmed (policy unit cost x units); `null` when the item had no
   * unit cost then. Absent on bookings confirmed before Phase 2. Never recomputed (see `booking-cost.ts`).
   */
  @Prop({ type: Object, default: undefined })
  cost?: { unitCost: number; quantity: number; total: number; currency: string; source: 'policy'; at: Date } | null;

  @Prop({ type: Date })
  cancellationRequestedAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  /** Append-only operational history that is not derivable from other fields. */
  @Prop({ type: [BookingEventSchema], default: undefined })
  events?: BookingEvent[];

  /** Internal staff notes (never shown to the customer). */
  @Prop({ type: [NoteSchema], default: undefined })
  notes?: Note[];

  createdAt: Date;
  updatedAt: Date;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
// Admin list filters and sorts.
BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ confirmedAt: 1 }, { sparse: true });
BookingSchema.index({ serviceDate: 1 });
BookingSchema.index({ customerId: 1, createdAt: -1 });
// Capacity counting for availability.
BookingSchema.index({ activitySlug: 1, optionId: 1, serviceDay: 1, status: 1 }, { sparse: true });
BookingSchema.index(
  { stockProductType: 1, stockProductRef: 1, stockVariantId: 1, serviceDay: 1, status: 1 },
  { sparse: true },
);
BookingSchema.index({ serviceDay: 1, status: 1 }, { sparse: true });
BookingSchema.index(
  { orderReference: 1, cartItemId: 1 },
  { unique: true, partialFilterExpression: { cartItemId: { $exists: true } } },
);
