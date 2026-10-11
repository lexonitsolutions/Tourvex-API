import { randomBytes } from 'node:crypto';
import type {
  ContentPayload,
  DocumentSchema,
  Field,
  Section,
  SectionSchema,
  ValidationIssue,
} from './cms.types';

/**
 * Pure validator + sanitiser for CMS payloads. Never throws: returns the cleaned value and an
 * issue list. Unknown fields are rejected, strings are stripped of control characters and no HTML
 * is accepted anywhere (the site renders content as text or through its markdown-subset renderer).
 */

export const MAX_SECTIONS = 40;
export const MAX_ISSUES = 100;
export const MAX_URL_LENGTH = 2048;
export const MAX_LINK_LABEL = 120;
export const MAX_ALT_LENGTH = 200;
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

// C0 controls (except TAB/LF/CR, handled per type), DEL, C1 controls, BOM and bidi override/isolate characters.
// Zero-width joiner and variation selectors are kept: emoji sequences need them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const HTML_LIKE = /<\s*[A-Za-z/!?]/;

export type IdGenerator = () => string;
export const defaultIdGenerator: IdGenerator = () => `i${randomBytes(5).toString('hex')}`;

export interface ValidateOptions {
  idGenerator?: IdGenerator;
}

class Collector {
  readonly issues: ValidationIssue[] = [];
  add(path: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ path, message });
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Single-line text: control characters removed, line breaks/tabs become spaces, trimmed. */
export function sanitizeText(value: string): string {
  return value
    .replace(/[\t\r\n]+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .trim();
}

/** Multi-line text: control characters removed, CRLF normalised to LF, trailing whitespace trimmed. */
export function sanitizeMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL_CHARS, '')
    .trim();
}

export function containsHtml(value: string): boolean {
  return HTML_LIKE.test(value);
}

const MEDIA_PATH = /^\/(?:images|api\/v1\/media\/images)\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const VIDEO_PATH = /^\/(?:videos|images|api\/v1\/media\/(?:videos|images))\/?.*$/;

/** Image URLs: the site's /images/..., the API media route, or https. Everything else is refused. */
export function isSafeImageUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith('/')) return MEDIA_PATH.test(url) && !url.includes('..');
  return isSafeHttpsUrl(url);
}

/** Video URLs: the site's /videos/..., the API media route, or https. */
export function isSafeVideoUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith('/')) return (VIDEO_PATH.test(url) || url.startsWith('/videos/')) && !url.includes('..');
  return isSafeHttpsUrl(url);
}

function isSafeHttpsUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F<>"\\]/.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname.length > 0 && !parsed.username && !parsed.password;
}

/**
 * Link targets: site-relative (`/path?query#hash`, never protocol-relative) or `https://`.
 * `http:`, `javascript:`, `data:` and every other scheme are blocked. `mailto:` and `tel:` are
 * accepted as a documented extension (contact details).
 */
export function isSafeHref(href: string): boolean {
  if (href.length === 0 || href.length > MAX_URL_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F<>"\\]/.test(href)) return false;
  if (href.startsWith('/')) return !href.startsWith('//');
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(href)) return true;
  if (/^tel:\+?[0-9][0-9\-().]{3,30}$/i.test(href)) return true;
  return isSafeHttpsUrl(href);
}

export interface RichtextIssue {
  message: string;
}

/**
 * Checks the markdown subset: `**bold**`, `*italic*`, `[text](url)`, line breaks and `- ` bullet
 * lists. HTML, images and unsafe link targets are refused.
 */
export function checkRichtext(value: string): RichtextIssue | null {
  if (containsHtml(value)) return { message: 'HTML is not allowed; use the markdown subset' };
  if (/!\[[^\]]*\]\(/.test(value)) return { message: 'Images are not allowed in rich text' };
  const linkPattern = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(value)) !== null) {
    if (match[1].trim().length === 0) return { message: 'A link needs text' };
    if (!isSafeHref(match[2].trim())) {
      return { message: `Unsafe or invalid link target "${match[2].slice(0, 40)}"` };
    }
  }
  // A "](" that is not part of a well-formed link is a malformed or smuggled link.
  const withoutLinks = value.replace(linkPattern, '');
  if (/\]\(/.test(withoutLinks)) return { message: 'Malformed link' };
  return null;
}

function checkString(
  collector: Collector,
  path: string,
  field: { required?: boolean; maxLength: number },
  raw: unknown,
  multiline: boolean,
): string | undefined {
  if (raw === undefined || raw === null) {
    if (field.required) collector.add(path, 'is required');
    return '';
  }
  if (typeof raw !== 'string') {
    collector.add(path, 'must be a string');
    return undefined;
  }
  const value = multiline ? sanitizeMultiline(raw) : sanitizeText(raw);
  if (field.required && value.length === 0) collector.add(path, 'is required');
  if (value.length > field.maxLength) collector.add(path, `must be at most ${field.maxLength} characters`);
  return value;
}

function checkListItemId(raw: unknown, seen: Set<string>, generate: IdGenerator): string {
  if (typeof raw === 'string' && ID_PATTERN.test(raw) && !seen.has(raw)) return raw;
  let id = generate();
  while (seen.has(id)) id = generate();
  return id;
}

function validateObjectFields(
  collector: Collector,
  path: string,
  fields: readonly Field[],
  raw: unknown,
  options: Required<ValidateOptions>,
  allowId: boolean,
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) {
    collector.add(path || '(root)', 'must be an object');
    return undefined;
  }
  const known = new Set(fields.map((field) => field.name));
  if (allowId) known.add('id');
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) collector.add(path ? `${path}.${key}` : key, 'is not a known field');
  }
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldPath = path ? `${path}.${field.name}` : field.name;
    result[field.name] = validateField(collector, fieldPath, field, raw[field.name], options);
  }
  return result;
}

function validateField(
  collector: Collector,
  path: string,
  field: Field,
  raw: unknown,
  options: Required<ValidateOptions>,
): unknown {
  switch (field.type) {
    case 'text': {
      const value = checkString(collector, path, field, raw, false);
      if (value === undefined) return '';
      if (containsHtml(value)) collector.add(path, 'HTML is not allowed');
      if (field.pattern && value.length > 0 && !new RegExp(field.pattern).test(value)) {
        collector.add(path, field.patternMessage ?? 'has an invalid format');
      }
      return value;
    }
    case 'textarea': {
      const value = checkString(collector, path, field, raw, true);
      if (value === undefined) return '';
      if (containsHtml(value)) collector.add(path, 'HTML is not allowed');
      return value;
    }
    case 'richtext': {
      const value = checkString(collector, path, field, raw, true);
      if (value === undefined) return '';
      const issue = checkRichtext(value);
      if (issue) collector.add(path, issue.message);
      return value;
    }
    case 'image': {
      if (raw === undefined || raw === null) {
        if (field.required) collector.add(path, 'is required');
        return { url: '', alt: '' };
      }
      if (!isPlainObject(raw)) {
        collector.add(path, 'must be an object {url, alt}');
        return { url: '', alt: '' };
      }
      for (const key of Object.keys(raw)) {
        if (key !== 'url' && key !== 'alt') collector.add(`${path}.${key}`, 'is not a known field');
      }
      const url = checkString(collector, `${path}.url`, { required: field.required, maxLength: MAX_URL_LENGTH }, raw.url, false) ?? '';
      if (url.length > 0 && !isSafeImageUrl(url)) {
        collector.add(`${path}.url`, 'must be /images/..., /api/v1/media/images/... or an https URL');
      }
      const alt = checkString(collector, `${path}.alt`, { maxLength: MAX_ALT_LENGTH }, raw.alt, false) ?? '';
      if (containsHtml(alt)) collector.add(`${path}.alt`, 'HTML is not allowed');
      return { url, alt };
    }
    case 'video': {
      if (raw === undefined || raw === null || raw === '') {
        if (field.required) collector.add(path, 'is required');
        return { url: '' };
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.length > 0 && !isSafeVideoUrl(trimmed)) {
          collector.add(`${path}.url`, 'must be /videos/..., /api/v1/media/videos/... or an https URL');
        }
        return { url: trimmed };
      }
      if (!isPlainObject(raw)) {
        collector.add(path, 'must be an object {url} or string URL');
        return { url: '' };
      }
      for (const key of Object.keys(raw)) {
        if (key !== 'url') collector.add(`${path}.${key}`, 'is not a known field');
      }
      const url = checkString(collector, `${path}.url`, { required: field.required, maxLength: MAX_URL_LENGTH }, (raw as any).url, false) ?? '';
      if (url.length > 0 && !isSafeVideoUrl(url)) {
        collector.add(`${path}.url`, 'must be /videos/..., /api/v1/media/videos/... or an https URL');
      }
      return { url };
    }
    case 'link': {
      if (raw === undefined || raw === null) {
        if (field.required) collector.add(path, 'is required');
        return { label: '', href: '' };
      }
      if (!isPlainObject(raw)) {
        collector.add(path, 'must be an object {label, href}');
        return { label: '', href: '' };
      }
      for (const key of Object.keys(raw)) {
        if (key !== 'label' && key !== 'href') collector.add(`${path}.${key}`, 'is not a known field');
      }
      const label = checkString(collector, `${path}.label`, { maxLength: MAX_LINK_LABEL }, raw.label, false) ?? '';
      const href = checkString(collector, `${path}.href`, { maxLength: MAX_URL_LENGTH }, raw.href, false) ?? '';
      if (containsHtml(label)) collector.add(`${path}.label`, 'HTML is not allowed');
      if (href.length > 0 && !isSafeHref(href)) {
        collector.add(`${path}.href`, 'must be a relative path starting with / or an https URL');
      }
      const hasAny = label.length > 0 || href.length > 0;
      if (field.required || hasAny) {
        if (label.length === 0) collector.add(`${path}.label`, 'is required');
        if (href.length === 0) collector.add(`${path}.href`, 'is required');
      }
      return { label, href };
    }
    case 'toggle': {
      if (raw === undefined || raw === null) return false;
      if (typeof raw !== 'boolean') {
        collector.add(path, 'must be true or false');
        return false;
      }
      return raw;
    }
    case 'number': {
      if (raw === undefined || raw === null) {
        collector.add(path, 'is required');
        return field.min;
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        collector.add(path, 'must be a number');
        return field.min;
      }
      if (raw < field.min || raw > field.max) collector.add(path, `must be between ${field.min} and ${field.max}`);
      return raw;
    }
    case 'select': {
      if (raw === undefined || raw === null || raw === '') {
        if (field.required) collector.add(path, 'is required');
        return '';
      }
      if (typeof raw !== 'string' || !field.options.some((option) => option.value === raw)) {
        collector.add(path, `must be one of: ${field.options.map((option) => option.value).join(', ')}`);
        return '';
      }
      return raw;
    }
    case 'color': {
      if (raw === undefined || raw === null || raw === '') {
        if (field.required) collector.add(path, 'is required');
        return '';
      }
      if (typeof raw !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw)) {
        collector.add(path, 'must be a colour like #1a2b3c');
        return '';
      }
      return raw.toLowerCase();
    }
    case 'list': {
      if (raw === undefined || raw === null) {
        if ((field.min ?? 0) > 0) collector.add(path, `needs at least ${field.min} item(s)`);
        return [];
      }
      if (!Array.isArray(raw)) {
        collector.add(path, 'must be a list');
        return [];
      }
      if (raw.length > field.max) collector.add(path, `can have at most ${field.max} items`);
      if (raw.length < (field.min ?? 0)) collector.add(path, `needs at least ${field.min} item(s)`);
      const seen = new Set<string>();
      const items: unknown[] = [];
      raw.slice(0, field.max + 1).forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        const cleaned = validateObjectFields(collector, itemPath, field.fields, item, options, true);
        if (!cleaned) return;
        const id = checkListItemId(isPlainObject(item) ? item.id : undefined, seen, options.idGenerator);
        seen.add(id);
        items.push({ id, ...cleaned });
      });
      return items;
    }
    case 'group': {
      if (raw === undefined || raw === null) return validateObjectFields(collector, path, field.fields, {}, options, false);
      return validateObjectFields(collector, path, field.fields, raw, options, false) ?? {};
    }
  }
}

export interface ValidationResult {
  ok: boolean;
  value: ContentPayload | null;
  issues: ValidationIssue[];
}

export type SectionSchemaMap = Record<string, SectionSchema>;

/** Validates and sanitises a flat object against a field list (used for global documents and sections). */
export function validateFields(
  fields: readonly Field[],
  raw: unknown,
  options: ValidateOptions = {},
): { value: Record<string, unknown>; issues: ValidationIssue[] } {
  const collector = new Collector();
  const resolved = { idGenerator: options.idGenerator ?? defaultIdGenerator };
  const value = validateObjectFields(collector, 'data', fields, raw, resolved, false) ?? {};
  return { value, issues: collector.issues };
}

/**
 * Validates a full document payload. Pages need `{sections}`, globals need `{data}`; anything else
 * (or both) is rejected. `fixed` sections must exist, `single` sections may appear once and
 * sections with `canDisable: false` cannot be switched off.
 */
export function validateDocumentPayload(
  schema: DocumentSchema,
  sectionSchemas: SectionSchemaMap,
  raw: unknown,
  options: ValidateOptions = {},
): ValidationResult {
  const collector = new Collector();
  const resolved = { idGenerator: options.idGenerator ?? defaultIdGenerator };

  if (!isPlainObject(raw)) {
    collector.add('(root)', 'payload must be an object');
    return { ok: false, value: null, issues: collector.issues };
  }

  if (schema.kind === 'global') {
    for (const key of Object.keys(raw)) {
      if (key !== 'data') collector.add(key, 'is not a known field; global documents only take "data"');
    }
    const data = validateObjectFields(collector, 'data', schema.fields ?? [], raw.data, resolved, false);
    const ok = collector.issues.length === 0 && data !== undefined;
    return { ok, value: ok ? { data } : null, issues: collector.issues };
  }

  for (const key of Object.keys(raw)) {
    if (key !== 'sections') collector.add(key, 'is not a known field; page documents only take "sections"');
  }
  const rawSections = raw.sections;
  if (!Array.isArray(rawSections)) {
    collector.add('sections', 'must be a list');
    return { ok: false, value: null, issues: collector.issues };
  }
  if (rawSections.length > MAX_SECTIONS) collector.add('sections', `can have at most ${MAX_SECTIONS} sections`);

  const allowed = new Set(schema.sections?.allowed ?? []);
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const sections: Section[] = [];

  rawSections.slice(0, MAX_SECTIONS + 1).forEach((entry, index) => {
    const path = `sections[${index}]`;
    if (!isPlainObject(entry)) {
      collector.add(path, 'must be an object');
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!['id', 'type', 'enabled', 'data'].includes(key)) collector.add(`${path}.${key}`, 'is not a known field');
    }
    const type = entry.type;
    if (typeof type !== 'string' || !allowed.has(type) || !sectionSchemas[type]) {
      collector.add(`${path}.type`, `must be one of: ${[...allowed].join(', ')}`);
      return;
    }
    const section = sectionSchemas[type];
    let id = entry.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      collector.add(`${path}.id`, 'must be 1-40 letters, digits, "-" or "_"');
      id = `invalid-${index}`;
    } else if (ids.has(id)) {
      collector.add(`${path}.id`, 'must be unique');
    }
    ids.add(id as string);
    counts.set(type, (counts.get(type) ?? 0) + 1);

    let enabled = true;
    if (entry.enabled !== undefined) {
      if (typeof entry.enabled !== 'boolean') collector.add(`${path}.enabled`, 'must be true or false');
      else enabled = entry.enabled;
    }
    if (!enabled && section.canDisable === false) {
      collector.add(`${path}.enabled`, `the "${section.label}" section cannot be disabled`);
      enabled = true;
    }

    const data = validateObjectFields(collector, `${path}.data`, section.fields, entry.data ?? {}, resolved, false);
    if (data) sections.push({ id: id as string, type, enabled, data });
  });

  for (const [type, count] of counts) {
    if (sectionSchemas[type]?.single && count > 1) {
      collector.add('sections', `"${sectionSchemas[type].label}" can only be used once`);
    }
  }
  for (const type of allowed) {
    if (sectionSchemas[type]?.fixed && !counts.has(type)) {
      collector.add('sections', `the "${sectionSchemas[type].label}" section is required and cannot be removed`);
    }
  }

  const ok = collector.issues.length === 0;
  return { ok, value: ok ? { sections } : null, issues: collector.issues };
}

/** Walks any JSON value and calls `visit` with every string (used for media reference scans). */
export function collectStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, visit));
  else if (isPlainObject(value)) Object.values(value).forEach((item) => collectStrings(item, visit));
}
