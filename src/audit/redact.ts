export const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /password|token|secret|card|key/i;
const MAX_DEPTH = 5;
const MAX_STRING = 1000;

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Deep-copies a value for the audit log, masking sensitive keys and bounding size. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner, depth + 1);
  }
  return result;
}

/** Field-level change; the whole pair is masked when the field name itself is sensitive. */
export function redactChange(change: FieldChange): FieldChange {
  if (isSensitiveKey(change.field)) return { field: change.field, from: REDACTED, to: REDACTED };
  return { field: change.field, from: redactValue(change.from), to: redactValue(change.to) };
}

export function redactChanges(changes: readonly FieldChange[]): FieldChange[] {
  return changes.slice(0, 200).map(redactChange);
}

/** `{field, from, to}` entries for the keys of `after` whose value differs from `before`. */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of Object.keys(after)) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
  }
  return changes;
}
