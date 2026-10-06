import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CmsDocumentDoc = HydratedDocument<CmsDocument>;

export const MAX_REVISIONS = 50;

export class CmsActor {
  @Prop({ type: String })
  id?: string;

  @Prop({ type: String })
  email?: string;
}

/** A published version kept for history/restore. `data` is the whole payload ({sections} or {data}). */
export class CmsRevision {
  @Prop({ type: Number, required: true })
  version: number;

  @Prop({ type: Object, required: true })
  data: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  publishedAt: Date;

  @Prop({ type: Object })
  publishedBy?: CmsActor;

  @Prop({ type: String, default: '' })
  note: string;
}

@Schema({ timestamps: true, collection: 'cms_documents', minimize: false })
export class CmsDocument {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  key: string;

  @Prop({ type: String, required: true, default: 'en' })
  locale: string;

  /** Working copy; null when there are no unpublished changes. */
  @Prop({ type: Object, default: null })
  draft: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  published: Record<string, unknown> | null;

  /** Increments on every publish; 0 = never published (the site serves the seed defaults). */
  @Prop({ type: Number, default: 0 })
  version: number;

  /** Increments on every draft change (save, discard, restore, publish): the optimistic-concurrency token. */
  @Prop({ type: Number, default: 0 })
  draftRevision: number;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Object })
  publishedBy?: CmsActor;

  @Prop({ type: Date, default: null })
  draftUpdatedAt: Date | null;

  @Prop({ type: Object })
  draftUpdatedBy?: CmsActor;

  @Prop({ type: [Object], default: [] })
  revisions: CmsRevision[];

  createdAt: Date;
  updatedAt: Date;
}

export const CmsDocumentSchema = SchemaFactory.createForClass(CmsDocument);
CmsDocumentSchema.index({ key: 1, locale: 1 }, { unique: true });
