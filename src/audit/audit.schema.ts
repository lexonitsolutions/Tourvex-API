import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ _id: false })
export class AuditChange {
  @Prop({ type: String, required: true })
  field: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  from?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  to?: unknown;
}
const AuditChangeSchema = SchemaFactory.createForClass(AuditChange);

/** Append-only record of staff mutations. No update or delete path exists (see the hooks below). */
@Schema({ collection: 'audit_logs', timestamps: false, versionKey: false })
export class AuditLog {
  _id: Types.ObjectId;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, required: true, lowercase: true })
  actorEmail: string;

  @Prop({ type: [String], default: [] })
  actorRoles: string[];

  /** e.g. `staff.update`, `booking.cancel` */
  @Prop({ type: String, required: true })
  action: string;

  @Prop({ type: String, required: true })
  entityType: string;

  @Prop({ type: String })
  entityId?: string;

  @Prop({ type: String, default: '' })
  summary: string;

  @Prop({ type: [AuditChangeSchema], default: [] })
  changes: AuditChange[];

  /** Salted HMAC-SHA256 of the caller IP; never the raw address. */
  @Prop({ type: String })
  ip?: string;

  @Prop({ type: String })
  requestId?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ at: -1 });
AuditLogSchema.index({ actorId: 1, at: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
AuditLogSchema.index({ action: 1, at: -1 });

export const AUDIT_IMMUTABLE_MESSAGE = 'Audit log entries are immutable';

const BLOCKED_QUERY_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteMany',
  'findOneAndDelete',
] as const;
for (const operation of BLOCKED_QUERY_OPERATIONS) {
  AuditLogSchema.pre(operation, function () {
    throw new Error(AUDIT_IMMUTABLE_MESSAGE);
  });
}
// Query-level deleteOne and document-level updateOne/deleteOne.
AuditLogSchema.pre('deleteOne', { document: true, query: true }, function () {
  throw new Error(AUDIT_IMMUTABLE_MESSAGE);
});
AuditLogSchema.pre('updateOne', { document: true, query: false }, function () {
  throw new Error(AUDIT_IMMUTABLE_MESSAGE);
});
// Creating is fine, re-saving an existing entry is not.
AuditLogSchema.pre('save', function () {
  if (!this.isNew) throw new Error(AUDIT_IMMUTABLE_MESSAGE);
});
