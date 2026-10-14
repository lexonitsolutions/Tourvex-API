import type { DocumentSchema, SectionSchema } from '../cms.types';
import { SUPPORTED_LOCALES } from '../cms.types';
import { GLOBAL_FOOTER_SCHEMA, GLOBAL_HEADER_SCHEMA, GLOBAL_SEO_SCHEMA } from './global';
import { HOME_SECTION_SCHEMAS, PAGE_HOME_SCHEMA } from './page-home';
import { ACTIVITIES_SECTION_SCHEMAS, PAGE_ACTIVITIES_SCHEMA } from './page-activities';
import { EVENTS_SECTION_SCHEMAS, PAGE_EVENTS_SCHEMA } from './page-events';
import { HOLIDAYS_SECTION_SCHEMAS, PAGE_HOLIDAYS_SCHEMA } from './page-holidays';
import { PAGE_VOYAGER_SCHEMA, VOYAGER_SECTION_SCHEMAS } from './page-voyager';

/**
 * The schema registry: the single source of truth for what can be edited. Adding a document or a
 * section = add its schema here + a seed in content/defaults (see docs/ADMIN_CMS.md).
 */
export const DOCUMENT_SCHEMAS: readonly DocumentSchema[] = [
  PAGE_HOME_SCHEMA,
  PAGE_ACTIVITIES_SCHEMA,
  PAGE_EVENTS_SCHEMA,
  PAGE_HOLIDAYS_SCHEMA,
  PAGE_VOYAGER_SCHEMA,
  GLOBAL_HEADER_SCHEMA,
  GLOBAL_FOOTER_SCHEMA,
  GLOBAL_SEO_SCHEMA,
];

/** Every section schema of every page document (types are unique across pages). */
export const SECTION_SCHEMAS: Readonly<Record<string, SectionSchema>> = Object.fromEntries(
  [...HOME_SECTION_SCHEMAS, ...ACTIVITIES_SECTION_SCHEMAS, ...EVENTS_SECTION_SCHEMAS, ...HOLIDAYS_SECTION_SCHEMAS, ...VOYAGER_SECTION_SCHEMAS].map((section) => [section.type, section]),
);

export const MAX_BATCH_KEYS = 10;

export function listDocumentKeys(): string[] {
  return DOCUMENT_SCHEMAS.map((schema) => schema.key);
}

export function getDocumentSchema(key: string): DocumentSchema | undefined {
  return DOCUMENT_SCHEMAS.find((schema) => schema.key === key);
}

/** The section schemas a page document may use, keyed by type. */
export function sectionSchemasFor(schema: DocumentSchema): Record<string, SectionSchema> {
  const result: Record<string, SectionSchema> = {};
  for (const type of schema.sections?.allowed ?? []) {
    const section = SECTION_SCHEMAS[type];
    if (section) result[type] = section;
  }
  return result;
}

export function isSupportedLocale(locale: string): boolean {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/** Sanity check of the registry itself (also run by the unit tests). Returns a list of problems. */
export function checkRegistry(): string[] {
  const problems: string[] = [];
  const seenKeys = new Set<string>();
  for (const schema of DOCUMENT_SCHEMAS) {
    if (seenKeys.has(schema.key)) problems.push(`duplicate document key ${schema.key}`);
    seenKeys.add(schema.key);
    if (schema.kind === 'page') {
      if (!schema.sections) problems.push(`${schema.key}: page without sections`);
      for (const type of schema.sections?.allowed ?? []) {
        if (!SECTION_SCHEMAS[type]) problems.push(`${schema.key}: unknown section type ${type}`);
      }
      for (const type of schema.sections?.default ?? []) {
        if (!schema.sections?.allowed.includes(type)) problems.push(`${schema.key}: default ${type} not allowed`);
      }
    } else if (!schema.fields?.length) {
      problems.push(`${schema.key}: global without fields`);
    }
  }
  return problems;
}
