import type {
  ColorField,
  Field,
  GroupField,
  ImageField,
  LinkField,
  ListField,
  NumberField,
  RichtextField,
  SelectField,
  TextareaField,
  TextField,
  ToggleField,
} from '../cms.types';

type Opts<T> = Partial<Omit<T, 'type' | 'name' | 'label'>>;

export const text = (name: string, label: string, maxLength: number, opts: Opts<TextField> = {}): TextField => ({
  name,
  type: 'text',
  label,
  maxLength,
  ...opts,
});
export const textarea = (name: string, label: string, maxLength: number, opts: Opts<TextareaField> = {}): TextareaField => ({
  name,
  type: 'textarea',
  label,
  maxLength,
  ...opts,
});
export const richtext = (name: string, label: string, maxLength: number, opts: Opts<RichtextField> = {}): RichtextField => ({
  name,
  type: 'richtext',
  label,
  maxLength,
  ...opts,
});
export const image = (name: string, label: string, opts: Opts<ImageField> = {}): ImageField => ({
  name,
  type: 'image',
  label,
  alt: true,
  ...opts,
});
export const link = (name: string, label: string, opts: Opts<LinkField> = {}): LinkField => ({
  name,
  type: 'link',
  label,
  ...opts,
});
export const toggle = (name: string, label: string, opts: Opts<ToggleField> = {}): ToggleField => ({
  name,
  type: 'toggle',
  label,
  ...opts,
});
export const number = (name: string, label: string, min: number, max: number, opts: Opts<NumberField> = {}): NumberField => ({
  name,
  type: 'number',
  label,
  min,
  max,
  ...opts,
});
export const select = (
  name: string,
  label: string,
  options: SelectField['options'],
  opts: Opts<SelectField> = {},
): SelectField => ({ name, type: 'select', label, options, ...opts });
export const color = (name: string, label: string, opts: Opts<ColorField> = {}): ColorField => ({
  name,
  type: 'color',
  label,
  ...opts,
});
export const list = (
  name: string,
  label: string,
  itemLabel: string,
  max: number,
  fields: Field[],
  opts: Opts<ListField> = {},
): ListField => ({ name, type: 'list', label, itemLabel, max, fields, ...opts });
export const group = (name: string, label: string, fields: Field[], opts: Opts<GroupField> = {}): GroupField => ({
  name,
  type: 'group',
  label,
  fields,
  ...opts,
});

/** Icon keys that the site maps to its own line icons (navTabs.js). */
export const NAV_ICONS: SelectField['options'] = [
  { value: 'activities', label: 'Compass (activities)' },
  { value: 'holidays', label: 'Sun (holidays)' },
  { value: 'visas', label: 'Passport (visas)' },
  { value: 'cruises', label: 'Ship (cruises)' },
  { value: 'yachts', label: 'Sailboat (yachts)' },
  { value: 'events', label: 'Ticket (events)' },
  { value: 'destinations', label: 'Map pin (destinations)' },
  { value: 'help', label: 'Phone (help)' },
];
