import type { Request } from 'express';
import { type AuditService, normalizeRequestId } from '../../audit/audit.service';
import { diffChanges, type FieldChange } from '../../audit/redact';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Base Mongo filter for admin lists: everything, optionally narrowed by published / sample. */
export function adminCatalogFilter(query: { published?: boolean; sample?: boolean }): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.published !== undefined) filter.published = query.published;
  if (query.sample !== undefined) filter.isSample = query.sample === true ? true : { $ne: true };
  return filter;
}

function clean(value: unknown, top: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => clean(v, false));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && '_bsontype' in value) return (value as { toString(): string }).toString();
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__v' || (key === '_id' && !top)) continue;
      out[key] = clean(inner, false);
    }
    return out;
  }
  return value;
}

/**
 * Full stored record for the admin editor: `_id` becomes `id`, `__v` and sub-document ids are
 * dropped, dates are ISO strings. `published` and `isSample` are always present.
 */
export function toAdminRecord(doc: Record<string, any>): Record<string, unknown> {
  const { _id, ...rest } = clean(doc, true) as Record<string, unknown>;
  return {
    id: String(_id),
    ...rest,
    published: Boolean(doc.published),
    isSample: Boolean(doc.isSample),
  };
}

export interface CatalogAuditEntry {
  action: string;
  entityId: string;
  summary: string;
  changes?: FieldChange[];
}

/** Writes one audit entry for a catalog mutation (never throws). */
export function recordCatalogAudit(
  audit: AuditService,
  actor: AuthenticatedUser,
  request: Request,
  entityType: string,
  entry: CatalogAuditEntry,
): Promise<void> {
  return audit.record({
    actor,
    entityType,
    ...entry,
    ip: request.ip,
    requestId: normalizeRequestId(request.headers['x-request-id']),
  });
}

/** Audit entries for an update: the field changes, plus a distinct publish/unpublish entry. */
export function planUpdateAudit(
  entity: string,
  before: Record<string, any>,
  dto: object,
): CatalogAuditEntry[] {
  const entityId = String(before.id);
  const label = String(before.title ?? before.name ?? entityId);
  const all = diffChanges(before, dto as Record<string, unknown>);
  const publishedChange = all.find((c) => c.field === 'published');
  const others = all.filter((c) => c.field !== 'published');
  const entries: CatalogAuditEntry[] = [];
  if (others.length || !publishedChange) {
    entries.push({
      action: `${entity}.update`,
      entityId,
      summary: `Updated ${entity} "${label}"`,
      changes: others,
    });
  }
  if (publishedChange) {
    const on = publishedChange.to === true;
    entries.push({
      action: `${entity}.${on ? 'publish' : 'unpublish'}`,
      entityId,
      summary: `${on ? 'Published' : 'Unpublished'} ${entity} "${label}"`,
      changes: [publishedChange],
    });
  }
  return entries;
}

export function planCreateAudit(entity: string, record: Record<string, any>, dto: object): CatalogAuditEntry {
  return {
    action: `${entity}.create`,
    entityId: String(record.id),
    summary: `Created ${entity} "${String(record.title ?? record.id)}"`,
    changes: Object.entries(dto).map(([field, to]) => ({ field, from: null, to })),
  };
}

export function planDeleteAudit(entity: string, before: Record<string, any>): CatalogAuditEntry {
  return {
    action: `${entity}.delete`,
    entityId: String(before.id),
    summary: `Deleted ${entity} "${String(before.title ?? before.id)}"`,
    changes: [],
  };
}
