import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Note, NoteSchema } from '../common/notes/notes';
import {
  CATALOG_TYPES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOST_REASONS,
} from './leads.rules';

export type LeadDocument = HydratedDocument<Lead>;

export const TIMELINE_TYPES = [
  'created',
  'status',
  'assigned',
  'follow_up',
  'contact',
  'priority',
  'update',
  'imported',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

/** One entry of the lead history (status changes, assignment, contact attempts). Append-only. */
@Schema({ _id: false })
export class LeadTimelineEntry {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: Date, required: true })
  at: Date;

  @Prop({ type: String, enum: TIMELINE_TYPES, required: true })
  type: TimelineType;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  actorName?: string;

  @Prop({ type: String, trim: true })
  from?: string;

  @Prop({ type: String, trim: true })
  to?: string;

  @Prop({ type: String, trim: true, maxlength: 500 })
  text?: string;
}
export const LeadTimelineEntrySchema = SchemaFactory.createForClass(LeadTimelineEntry);

@Schema({ _id: false })
export class LeadCatalogRef {
  @Prop({ type: String, enum: CATALOG_TYPES, required: true })
  type: string;

  @Prop({ type: String, required: true, trim: true })
  slug: string;

  @Prop({ type: Types.ObjectId })
  id?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  title?: string;
}
export const LeadCatalogRefSchema = SchemaFactory.createForClass(LeadCatalogRef);

/**
 * Unified lead (website enquiries, contact form, B2B). One lead per (source, sourceRef); the
 * enquiry collections of each module stay as they are and link here by reference.
 * Personal data is limited to what the visitor submitted. Never log it.
 */
@Schema({ timestamps: true, collection: 'leads' })
export class Lead {
  _id: Types.ObjectId;

  /** Human reference shown in the CRM (LD-000123 style); also the enquiry reference for site enquiries. */
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  reference: string;

  @Prop({ type: String, enum: LEAD_SOURCES, required: true, index: true })
  source: string;

  /** Reference of the originating enquiry (VIS-..., CRU-..., contact reference). */
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  sourceRef: string;

  /** Originating enquiry document id, when there is one. */
  @Prop({ type: Types.ObjectId })
  sourceId?: Types.ObjectId;

  @Prop({ type: LeadCatalogRefSchema })
  catalog?: LeadCatalogRef;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true, maxlength: 254, index: true })
  email: string;

  @Prop({ type: String, trim: true, maxlength: 30 })
  phone?: string;

  @Prop({ type: String, trim: true, maxlength: 80 })
  nationality?: string;

  /** Short headline: the contact subject or a detail such as the cabin type. */
  @Prop({ type: String, trim: true, maxlength: 200 })
  subject?: string;

  @Prop({ type: String, trim: true, maxlength: 2000 })
  message?: string;

  @Prop({ type: Number, min: 1, max: 100 })
  pax?: number;

  @Prop({ type: Number, min: 0, max: 100 })
  adults?: number;

  @Prop({ type: Number, min: 0, max: 100 })
  children?: number;

  @Prop({ type: Date })
  travelDate?: Date;

  /** Optional value estimate in AED. */
  @Prop({ type: Number, min: 0, max: 100_000_000 })
  valueAed?: number;

  @Prop({ type: String, enum: LEAD_STATUSES, default: 'new', index: true })
  status: string;

  @Prop({ type: String, enum: LOST_REASONS })
  lostReason?: string;

  @Prop({ type: String, enum: LEAD_PRIORITIES, default: 'normal' })
  priority: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  ownerId?: Types.ObjectId;

  @Prop({ type: Date })
  nextFollowUpAt?: Date;

  @Prop({ type: Date })
  lastContactedAt?: Date;

  @Prop({ type: Date })
  closedAt?: Date;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [NoteSchema], default: [] })
  notes: Note[];

  @Prop({ type: [LeadTimelineEntrySchema], default: [] })
  timeline: LeadTimelineEntry[];

  @Prop({ type: Boolean, default: false })
  marketingOptOut: boolean;

  @Prop({ type: Date, required: true })
  consentAt: Date;

  /** Local user id when a valid Clerk session accompanied the submission. */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);
// Idempotent capture: a second submission with the same reference links to the same lead.
LeadSchema.index({ source: 1, sourceRef: 1 }, { unique: true });
LeadSchema.index({ reference: 1 }, { unique: true });
LeadSchema.index({ status: 1, createdAt: -1 });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ ownerId: 1, status: 1 });
LeadSchema.index({ nextFollowUpAt: 1 }, { sparse: true });
