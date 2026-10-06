import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  MESSAGE_MAX_LENGTH,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from './tickets.rules';

export type TicketDocument = HydratedDocument<Ticket>;

export const AUTHOR_TYPES = ['customer', 'staff', 'system'] as const;

@Schema({ _id: false })
export class TicketMessage {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: String, enum: AUTHOR_TYPES, required: true })
  authorType: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  authorId?: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 120 })
  authorName?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: MESSAGE_MAX_LENGTH })
  body: string;

  /** Internal notes are visible to staff only and never returned by the customer API. */
  @Prop({ type: Boolean, default: false })
  internal: boolean;

  @Prop({ type: Date, required: true })
  at: Date;
}
export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);

@Schema({ _id: false })
export class TicketRequester {
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 120 })
  name?: string;

  @Prop({ type: String, trim: true, lowercase: true, maxlength: 254 })
  email?: string;
}
export const TicketRequesterSchema = SchemaFactory.createForClass(TicketRequester);

/** Support ticket. Personal data limited to the requester's own name and e-mail. Never log message bodies. */
@Schema({ timestamps: true, collection: 'tickets' })
export class Ticket {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  number: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 150 })
  subject: string;

  @Prop({ type: String, enum: TICKET_CATEGORIES, required: true })
  category: string;

  @Prop({ type: String, enum: TICKET_PRIORITIES, default: 'normal' })
  priority: string;

  @Prop({ type: String, enum: TICKET_STATUSES, default: 'open', index: true })
  status: string;

  @Prop({ type: TicketRequesterSchema, required: true })
  requester: TicketRequester;

  @Prop({ type: Types.ObjectId, ref: 'Booking' })
  bookingId?: Types.ObjectId;

  /** Denormalised so lists and the admin panel do not need a booking lookup. */
  @Prop({ type: String, trim: true })
  bookingReference?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assigneeId?: Types.ObjectId;

  @Prop({ type: [TicketMessageSchema], default: [] })
  messages: TicketMessage[];

  /** Last customer-visible message, for list previews and ordering. */
  @Prop({ type: Date })
  lastMessageAt?: Date;

  @Prop({ type: String, enum: ['customer', 'staff'] })
  lastMessageBy?: string;

  @Prop({ type: Number, default: 0 })
  publicMessageCount: number;

  /** First public staff reply (SLA). */
  @Prop({ type: Date })
  firstResponseAt?: Date;

  @Prop({ type: Date })
  resolvedAt?: Date;

  @Prop({ type: Date })
  closedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
TicketSchema.index({ 'requester.userId': 1, createdAt: -1 });
TicketSchema.index({ status: 1, createdAt: -1 });
TicketSchema.index({ assigneeId: 1, status: 1 });
TicketSchema.index({ createdAt: -1 });
