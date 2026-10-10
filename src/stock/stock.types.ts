/** Shared vocabulary of the stock module (see docs/STOCK_API.md). */

export const PRODUCT_TYPES = ['activity', 'holiday', 'cruise', 'event', 'yacht', 'transfer', 'hotel', 'custom'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Products that have a catalog page; their items are virtual (derived from the catalog). */
export const CATALOG_PRODUCT_TYPES = ['activity', 'holiday', 'cruise', 'event'] as const;
export type CatalogProductType = (typeof CATALOG_PRODUCT_TYPES)[number];

/** Items an admin creates by hand (no product pages yet). */
export const MANUAL_PRODUCT_TYPES = ['yacht', 'transfer', 'hotel', 'custom'] as const;
export type ManualProductType = (typeof MANUAL_PRODUCT_TYPES)[number];

/** Enquiry-based products that staff can confirm into a booking. */
export const ENQUIRY_SOURCES = ['holiday', 'cruise', 'event'] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

export const MOVEMENT_TYPES = [
  'set_default',
  'set_day',
  'set_cost',
  'adjust_add',
  'adjust_remove',
  'close',
  'open',
  'stop_sale',
  'resume_sale',
  'restock_auto',
  'restock_manual',
  'booking_confirmed',
  'booking_cancelled',
  'alert_low',
  'alert_sold_out',
  'create_item',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const PAYMENT_MODES = ['cash', 'bank_transfer', 'card_offline', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export type ItemStatus = 'unlimited' | 'ok' | 'low' | 'sold_out' | 'closed';
export type DayStatus = ItemStatus | 'non_operational' | 'past';
export type CapacitySource = 'override' | 'default' | 'legacy' | 'unlimited';

/** Days the admin screens and alerts look at: today .. today + 29. */
export const WINDOW_DAYS = 30;
/** Days looked at to decide whether a product is still bookable at all (public listing filter). */
export const HORIZON_DAYS = 120;
/** Days looked at for the public "Only X left" message. */
export const LOW_STOCK_LOOKAHEAD_DAYS = 14;
export const MAX_RANGE_DAYS = 93;
export const RANGED_LEDGER_SUMMARY_DAYS = 31;
export const DEFAULT_LOW_STOCK_THRESHOLD = 10;
export const DEFAULT_RESTOCK_CUTOFF_HOURS = 24;

export interface ItemKey {
  productType: ProductType;
  productRef: string;
  variantId: string;
}

export interface LockKey extends ItemKey {
  /** Service day, YYYY-MM-DD. */
  day: string;
}

/** `"{productType}:{productRef}:{variantId}"`; the variant may itself contain colons. */
export function formatItemId(key: ItemKey): string {
  return `${key.productType}:${key.productRef}:${key.variantId}`;
}

/** Inverse of `formatItemId`; accepts the URL-encoded form too. Null when it is not a valid id. */
export function parseItemId(raw: string): ItemKey | null {
  let id = raw;
  if (!id.includes(':')) {
    try {
      id = decodeURIComponent(id);
    } catch {
      return null;
    }
  }
  const first = id.indexOf(':');
  const second = first < 0 ? -1 : id.indexOf(':', first + 1);
  if (first < 0 || second < 0) return null;
  const productType = id.slice(0, first);
  const productRef = id.slice(first + 1, second);
  const variantId = id.slice(second + 1);
  if (!(PRODUCT_TYPES as readonly string[]).includes(productType) || !productRef || !variantId) return null;
  return { productType: productType as ProductType, productRef, variantId };
}

export const itemKeyString = (key: ItemKey) => `${key.productType}|${key.productRef}|${key.variantId}`;
