export const HOLIDAY_SORTS = [
  'popular',
  'price_asc',
  'price_desc',
  'nights_asc',
  'nights_desc',
  'newest',
] as const;
export type HolidaySort = (typeof HOLIDAY_SORTS)[number];

export interface HolidayFilterInput {
  q?: string;
  destination?: string;
  country?: string;
  theme?: string;
  collection?: string;
  minNights?: number;
  maxNights?: number;
}

/** Lower-case ASCII slug (max 80 chars). Returns '' when nothing usable remains. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Sample packages are visible outside production, or in production only when explicitly allowed. */
export function shouldExposeSamples(nodeEnv: string | undefined, allowSamples: string | undefined): boolean {
  return nodeEnv !== 'production' || String(allowSamples).toLowerCase() === 'true';
}

/** Mongo filter for what the public may see. */
export function publicVisibilityFilter(showSamples: boolean): Record<string, unknown> {
  return showSamples ? { published: true } : { published: true, isSample: { $ne: true } };
}

/** Builds the list filter. `base` is the visibility filter (empty for admin). */
export function buildHolidayFilter(
  query: HolidayFilterInput,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...base };
  if (query.q?.trim()) filter.$text = { $search: query.q.trim() };
  if (query.destination) filter.destinations = query.destination;
  if (query.country) filter.country = query.country;
  if (query.theme) filter.themes = query.theme;
  if (query.collection) filter.collections = query.collection;
  if (query.minNights !== undefined || query.maxNights !== undefined) {
    const nights: Record<string, number> = {};
    if (query.minNights !== undefined) nights.$gte = query.minNights;
    if (query.maxNights !== undefined) nights.$lte = query.maxNights;
    filter.durationNights = nights;
  }
  return filter;
}

export interface HolidaySortSpec {
  /** Computed field needed for sorting, added before $sort. */
  addFields?: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
}

const EFFECTIVE_PRICE = { $ifNull: ['$salePrice.amount', '$price.amount'] };

/** Maps the public sort keyword to an aggregation sort. Packages without a price sort last. */
export function buildHolidaySort(sort: HolidaySort = 'popular'): HolidaySortSpec {
  switch (sort) {
    case 'price_asc':
      return {
        addFields: { _sortPrice: { $ifNull: [EFFECTIVE_PRICE, Number.MAX_SAFE_INTEGER] } },
        sort: { _sortPrice: 1, popularity: -1, _id: 1 },
      };
    case 'price_desc':
      return {
        addFields: { _sortPrice: { $ifNull: [EFFECTIVE_PRICE, -1] } },
        sort: { _sortPrice: -1, popularity: -1, _id: 1 },
      };
    case 'nights_asc':
      return { sort: { durationNights: 1, popularity: -1, _id: 1 } };
    case 'nights_desc':
      return { sort: { durationNights: -1, popularity: -1, _id: 1 } };
    case 'newest':
      return { sort: { createdAt: -1, _id: 1 } };
    case 'popular':
    default:
      return { sort: { popularity: -1, createdAt: -1, _id: 1 } };
  }
}
