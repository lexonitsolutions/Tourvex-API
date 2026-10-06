import type { FieldChange } from '../audit/redact';

const MAX_CHANGES = 40;
const MAX_VALUE = 160;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function brief(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'string') return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}...` : value;
  if (isObject(value) || Array.isArray(value)) return `[${Array.isArray(value) ? 'list' : 'group'}]`;
  return value;
}

function walk(path: string, before: unknown, after: unknown, out: FieldChange[]): void {
  if (out.length >= MAX_CHANGES) return;
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      walk(path ? `${path}.${key}` : key, before[key], after[key], out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const byId = (list: unknown[]) =>
      list.every((item) => isObject(item) && typeof item.id === 'string')
        ? new Map(list.map((item) => [(item as { id: string }).id, item]))
        : null;
    const beforeIds = byId(before);
    const afterIds = byId(after);
    if (beforeIds && afterIds) {
      // Items carry stable ids: report additions, removals, moves and per-field edits by id.
      for (const [id, item] of afterIds) {
        walk(`${path}[${id}]`, beforeIds.get(id), item, out);
      }
      for (const [id, item] of beforeIds) {
        if (!afterIds.has(id)) walk(`${path}[${id}]`, item, undefined, out);
      }
      const orderBefore = [...beforeIds.keys()].filter((id) => afterIds.has(id)).join(',');
      const orderAfter = [...afterIds.keys()].filter((id) => beforeIds.has(id)).join(',');
      if (orderBefore !== orderAfter && out.length < MAX_CHANGES) {
        out.push({ field: `${path}.order`, from: orderBefore, to: orderAfter });
      }
      return;
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ field: path || '(root)', from: brief(before), to: brief(after) });
  }
}

/**
 * Field-level change summary between two payloads for the audit log: changed leaves addressed by
 * path (list items by their stable id), long strings truncated, capped at 40 entries. Contains
 * content only, never anything sensitive.
 */
export function summarizeChanges(before: unknown, after: unknown): FieldChange[] {
  const out: FieldChange[] = [];
  walk('', before, after, out);
  return out;
}
