/** Field / section / document schema types (see docs/CMS_API.md). Served to the admin so forms are generated. */

interface FieldBase {
  name: string;
  label: string;
  help?: string;
  required?: boolean;
}

export interface TextField extends FieldBase {
  type: 'text';
  maxLength: number;
  placeholder?: string;
  /** Additive: regular expression source the (trimmed) value must match when non-empty. */
  pattern?: string;
  patternMessage?: string;
}
export interface TextareaField extends FieldBase {
  type: 'textarea';
  maxLength: number;
  rows?: number;
}
export interface RichtextField extends FieldBase {
  type: 'richtext';
  maxLength: number;
}
export interface ImageField extends FieldBase {
  type: 'image';
  aspect?: string;
  alt: true;
}
export interface VideoField extends FieldBase {
  type: 'video';
}
export interface LinkField extends FieldBase {
  type: 'link';
}
export interface ToggleField extends FieldBase {
  type: 'toggle';
}
export interface NumberField extends FieldBase {
  type: 'number';
  min: number;
  max: number;
}
export interface SelectField extends FieldBase {
  type: 'select';
  options: { value: string; label: string }[];
}
export interface ColorField extends FieldBase {
  type: 'color';
}
export interface ListField extends FieldBase {
  type: 'list';
  itemLabel: string;
  min?: number;
  max: number;
  fields: Field[];
}
export interface GroupField extends FieldBase {
  type: 'group';
  fields: Field[];
}

export type Field =
  | TextField
  | TextareaField
  | RichtextField
  | ImageField
  | VideoField
  | LinkField
  | ToggleField
  | NumberField
  | SelectField
  | ColorField
  | ListField
  | GroupField;

export interface SectionSchema {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  fixed?: boolean;
  canDisable?: boolean;
  /** Additive: at most one section of this type per page. */
  single?: boolean;
  fields: Field[];
}

export type DocumentKind = 'page' | 'global';

export interface DocumentSchema {
  key: string;
  label: string;
  description?: string;
  kind: DocumentKind;
  sections?: { allowed: string[]; default: string[] };
  fields?: Field[];
  previewPath?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface Section {
  id: string;
  type: string;
  enabled: boolean;
  data: Record<string, unknown>;
}

/** What is stored/served: pages carry `sections`, globals carry `data`. */
export type ContentPayload = { sections: Section[] } | { data: Record<string, unknown> };

export const SUPPORTED_LOCALES = ['en'] as const;
export type CmsLocale = (typeof SUPPORTED_LOCALES)[number];
