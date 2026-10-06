import { randomBytes } from 'node:crypto';

/**
 * Pure pricing, promo and hold helpers. All arithmetic is done in integer minor units (fils) so a
 * cart total always equals the sum of its items and the PaymentIntent amount.
 */

export const CURRENCY = 'AED';

export interface MoneyValue {
  amount: number;
  currency: string;
}

export interface PriceLine {
  label: string;
  unit: MoneyValue;
  qty: number;
  total: MoneyValue;
}

export const toMinor = (amount: number): number => Math.round(amount * 100 + Math.sign(amount) * 1e-7);
export const fromMinor = (minor: number): number => minor / 100;
export const moneyOf = (minor: number): MoneyValue => ({ amount: fromMinor(minor), currency: CURRENCY });

export function priceTravellers(input: {
  adultPrice: MoneyValue;
  childPrice?: MoneyValue | null;
  adults: number;
  children: number;
}): { lines: PriceLine[]; subtotalMinor: number } {
  const { adultPrice, childPrice, adults, children } = input;
  const lines: PriceLine[] = [];
  let subtotalMinor = 0;
  if (adults > 0) {
    const unit = toMinor(adultPrice.amount);
    lines.push({
      label: `${adults} ${adults === 1 ? 'adult' : 'adults'} x`,
      unit: moneyOf(unit),
      qty: adults,
      total: moneyOf(unit * adults),
    });
    subtotalMinor += unit * adults;
  }
  if (children > 0) {
    if (!childPrice) throw new Error('Child price is required to price children');
    const unit = toMinor(childPrice.amount);
    lines.push({
      label: `${children} ${children === 1 ? 'child' : 'children'} x`,
      unit: moneyOf(unit),
      qty: children,
      total: moneyOf(unit * children),
    });
    subtotalMinor += unit * children;
  }
  return { lines, subtotalMinor };
}

export const taxMinor = (baseMinor: number, percent: number): number =>
  Math.round((baseMinor * percent) / 100 + 1e-7);

export interface PromoRules {
  type: 'percent' | 'fixed';
  value: number;
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  appliesTo?: string[] | null;
}

/** Discount for the part of the cart the promo applies to; 0 when the minimum spend is not met. */
export function promoDiscountMinor(promo: PromoRules, eligibleSubtotalMinor: number): number {
  if (eligibleSubtotalMinor <= 0) return 0;
  if (promo.minSubtotal != null && eligibleSubtotalMinor < toMinor(promo.minSubtotal)) return 0;
  let discount =
    promo.type === 'percent'
      ? Math.round((eligibleSubtotalMinor * promo.value) / 100)
      : toMinor(promo.value);
  if (promo.maxDiscount != null) discount = Math.min(discount, toMinor(promo.maxDiscount));
  return Math.max(0, Math.min(discount, eligibleSubtotalMinor));
}

export type PromoRejection = 'unpublished' | 'not_started' | 'expired' | 'exhausted';

export function promoRejection(
  promo: {
    published: boolean;
    validFrom?: Date | null;
    validTo?: Date | null;
    usageLimit?: number | null;
    usedCount: number;
  },
  now: Date,
): PromoRejection | null {
  if (!promo.published) return 'unpublished';
  if (promo.validFrom && now < promo.validFrom) return 'not_started';
  if (promo.validTo && now > promo.validTo) return 'expired';
  if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) return 'exhausted';
  return null;
}

/** Splits `total` across weights with the largest-remainder method; the parts always sum to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) parts[order[i].index] += 1;
  return parts;
}

export interface CartPriceInput {
  slug: string;
  subtotalMinor: number;
}

export interface CartPriceResult {
  items: { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number }[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Total = (subtotal - discount) + tax, tax = percent of the discounted amount, per item. */
export function priceCart(
  items: CartPriceInput[],
  promo: PromoRules | null,
  taxPercent: number,
): CartPriceResult {
  const eligible = items.map((item) => (!promo?.appliesTo?.length || promo.appliesTo.includes(item.slug) ? item.subtotalMinor : 0));
  const eligibleTotal = eligible.reduce((a, b) => a + b, 0);
  const discount = promo ? promoDiscountMinor(promo, eligibleTotal) : 0;
  const shares = allocate(discount, eligible);
  const priced = items.map((item, i) => {
    const base = item.subtotalMinor - shares[i];
    const tax = taxMinor(base, taxPercent);
    return { subtotalMinor: item.subtotalMinor, discountMinor: shares[i], taxMinor: tax, totalMinor: base + tax };
  });
  const sum = (key: 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor') =>
    priced.reduce((acc, item) => acc + item[key], 0);
  return {
    items: priced,
    subtotalMinor: sum('subtotalMinor'),
    discountMinor: sum('discountMinor'),
    taxMinor: sum('taxMinor'),
    totalMinor: sum('totalMinor'),
  };
}

export const holdExpiry = (now: Date, minutes: number): Date => new Date(now.getTime() + minutes * 60_000);

/** A hold counts against capacity only while its expiry is in the future. */
export const isHoldActive = (expiresAt: Date | null | undefined, now: Date): boolean =>
  !!expiresAt && expiresAt.getTime() > now.getTime();

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `OR-` + 8 base32 characters (40 random bits). */
export function generateOrderReference(): string {
  const bytes = randomBytes(5);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let out = '';
  for (let i = 7; i >= 0; i--) out += BASE32[Number((bits >> BigInt(i * 5)) & 31n)];
  return `OR-${out}`;
}
