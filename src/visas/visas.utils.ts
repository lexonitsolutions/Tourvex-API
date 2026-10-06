import { randomBytes } from 'node:crypto';

// Sample visibility and slug helpers are shared with the holidays feature.
export {
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
} from '../holidays/holidays.utils';

export const VISA_KINDS = ['evisa', 'embassy'] as const;
export type VisaKind = (typeof VISA_KINDS)[number];

export const VISA_ENTRIES = ['single', 'multiple', 'varies'] as const;
export type VisaEntries = (typeof VISA_ENTRIES)[number];

export const VISA_SORTS = ['popular', 'price_asc', 'price_desc', 'name'] as const;
export type VisaSort = (typeof VISA_SORTS)[number];

export const ENQUIRY_STATUSES = ['new', 'contacted', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface VisaFilterInput {
  q?: string;
  kind?: VisaKind;
  country?: string;
}

/** Base letters mapped to the accented forms that should also match (so "turk" finds "Türkiye"). */
const DIACRITIC_CLASSES: Record<string, string> = {
  a: 'aàáâãäåāăą',
  c: 'cçćčĉċ',
  e: 'eèéêëēĕėęě',
  g: 'gğĝġģ',
  i: 'iìíîïīĭįıİ',
  n: 'nñńňņ',
  o: 'oòóôõöøōŏő',
  s: 'sśšşŝș',
  u: 'uùúûüūŭůűų',
  y: 'yýÿŷ',
  z: 'zźżž',
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Case- and diacritic-insensitive substring pattern for the free-text query. The input is escaped,
 * so user text can never inject regex syntax.
 */
export function buildSearchRegex(q: string): RegExp {
  const folded = q
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const pattern = [...folded]
    .map((char) => {
      const variants = DIACRITIC_CLASSES[char];
      return variants ? `[${variants}]` : escapeRegex(char);
    })
    .join('');
  return new RegExp(pattern, 'i');
}

/** Builds the list filter. `base` is the visibility filter (empty for admin). */
export function buildVisaFilter(
  query: VisaFilterInput,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...base };
  const q = query.q?.trim();
  if (q) {
    const pattern = buildSearchRegex(q);
    filter.$or = [{ country: pattern }, { title: pattern }];
  }
  if (query.kind) filter.kind = query.kind;
  if (query.country) filter.country = query.country;
  return filter;
}

export interface VisaSortSpec {
  /** Computed field needed for sorting, added before $sort. */
  addFields?: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
  /** Locale-aware ordering for alphabetical sorts (so "Türkiye" sorts with the T's). */
  collation?: { locale: string; strength: number };
}

/** Maps the public sort keyword to an aggregation sort. Visas without a price sort last. */
export function buildVisaSort(sort: VisaSort = 'popular'): VisaSortSpec {
  switch (sort) {
    case 'price_asc':
      return {
        addFields: { _sortPrice: { $ifNull: ['$startingPrice.amount', Number.MAX_SAFE_INTEGER] } },
        sort: { _sortPrice: 1, popularity: -1, _id: 1 },
      };
    case 'price_desc':
      return {
        addFields: { _sortPrice: { $ifNull: ['$startingPrice.amount', -1] } },
        sort: { _sortPrice: -1, popularity: -1, _id: 1 },
      };
    case 'name':
      return { sort: { country: 1, title: 1, _id: 1 }, collation: { locale: 'en', strength: 1 } };
    case 'popular':
    default:
      return { sort: { popularity: -1, country: 1, _id: 1 } };
  }
}

/** RFC 4648 base32 alphabet (A-Z, 2-7): 32 symbols, so `byte & 31` is unbiased. */
const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const ENQUIRY_REFERENCE_PATTERN = /^VQ-[A-Z2-7]{8}$/;

/** `<prefix>-` plus 8 crypto-random base32 characters (about 40 bits). Uniqueness is enforced by an index. */
export function generateReference(prefix: string): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) code += REFERENCE_ALPHABET[byte & 31];
  return `${prefix}-${code}`;
}

/** `VQ-` plus 8 crypto-random base32 characters. */
export function generateEnquiryReference(): string {
  return generateReference('VQ');
}

/** True when the ISO date is today or later (compared on the UTC calendar day). */
export function isNotPastDate(value: string, now: Date = new Date()): boolean {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return time >= startOfToday;
}
