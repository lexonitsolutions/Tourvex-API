import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VoucherDocument = HydratedDocument<Voucher>;

export const VOUCHER_STATUSES = ['issued', 'redeemed', 'void'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/**
 * One voucher (ticket) per confirmed booking. The code is random and unguessable (voucher-code.ts)
 * and is the only thing the QR carries, so no booking or personal data is ever encoded in it.
 */
@Schema({ timestamps: true, collection: 'vouchers' })
export class Voucher {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  code: string;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, unique: true })
  bookingId: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  bookingReference: string;

  @Prop({ type: String, enum: VOUCHER_STATUSES, required: true, default: 'issued', index: true })
  status: VoucherStatus;

  @Prop({ type: Date, required: true })
  issuedAt: Date;

  @Prop({ type: Date })
  redeemedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  redeemedBy?: Types.ObjectId;

  @Prop({ type: String })
  redeemedByName?: string;

  @Prop({ type: Date })
  voidedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  voidedBy?: Types.ObjectId;

  @Prop({ type: String, maxlength: 300 })
  voidReason?: string;

  @Prop({ type: Number, default: 0 })
  resendCount: number;

  @Prop({ type: Date })
  lastSentAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const VoucherSchema = SchemaFactory.createForClass(Voucher);
VoucherSchema.index({ issuedAt: -1 });
VoucherSchema.index({ redeemedAt: -1 }, { sparse: true });
