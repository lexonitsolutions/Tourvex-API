import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RefundDocument = HydratedDocument<Refund>;

export const REFUND_MODES = ['stripe', 'mock', 'manual'] as const;
export type RefundMode = (typeof REFUND_MODES)[number];
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * Refund ledger: one row per refund attempt. Only succeeded rows count as refunded; a failed row
 * documents an attempt whose reserved amount was released again.
 */
@Schema({ timestamps: true, collection: 'refunds' })
export class Refund {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  bookingId: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  bookingReference: string;

  @Prop({ type: String })
  orderReference?: string;

  /** Refunded amount in the booking currency (AED). */
  @Prop({ type: Number, required: true, min: 0.01 })
  amount: number;

  @Prop({ type: Number, required: true, min: 1 })
  amountMinor: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 300 })
  reason: string;

  /** stripe = real Stripe refund, mock = simulated (PAYMENTS_MOCK), manual = recorded only. */
  @Prop({ type: String, enum: REFUND_MODES, required: true })
  mode: RefundMode;

  @Prop({ type: String, enum: REFUND_STATUSES, required: true, default: 'pending', index: true })
  status: RefundStatus;

  @Prop({ type: String })
  paymentReference?: string;

  /** Stripe refund id (re_...) or a re_mock_... marker. */
  @Prop({ type: String })
  providerRefundId?: string;

  @Prop({ type: String })
  failureMessage?: string;

  /** Client-supplied key: repeating the same request returns the original refund. */
  @Prop({ type: String })
  idempotencyKey?: string;

  @Prop({ type: String })
  creditNoteNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String })
  actorEmail?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ createdAt: -1 });
RefundSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
