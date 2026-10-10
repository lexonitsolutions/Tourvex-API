import { allocate } from '../checkout/checkout-pricing';

/**
 * Pure tax rules: which regime/rate applies, and how money is split. No I/O. All money is in integer minor units
 * (fils/paise/cents); percentages carry at most three decimals.
 */

export type TaxModel = 'single' | 'india_gst';
export type TaxComponentCode = 'VAT' | 'CGST' | 'SGST' | 'IGST';

export interface TaxRate {
  code: string;
  label: string;
  percent: number;
  isDefault: boolean;
}

export interface ServiceCode {
  label: string;
  value: string;
  description?: string;
}

export interface NumberingRule {
  prefix: string;
  creditPrefix: string;
  includeCountry: boolean;
  yearDigits: 2 | 4;
  sequenceDigits: number;
  maxLength?: number | null;
}

/** What the rules need to know about a regime (a stored regime satisfies it). */
export interface RegimeRule {
  id: string;
  country: string;
  countryName: string;
  taxName: string;
  invoiceTitle: string;
  registrationLabel: string;
  model: TaxModel;
  rates: TaxRate[];
  serviceCode?: ServiceCode | null;
  pricesIncludeTax: boolean;
  numbering: NumberingRule;
  invoiceNotes?: string | null;
  qr: 'none' | 'zatca';
  active: boolean;
}

export interface SellerRule {
  id: string;
  country: string;
  state?: string | null;
  stateCode?: string | null;
  isDefault: boolean;
  active: boolean;
}

export interface TaxComponent {
  code: TaxComponentCode;
  label: string;
  percent: number;
}

export interface PlaceOfSupply {
  country: string;
  state?: string;
  stateCode?: string;
}

export interface TaxOverride {
  country?: string;
  rateCode?: string;
  placeOfSupplyState?: string;
  placeOfSupplyStateCode?: string;
}

export interface TaxDetermination {
  /** null only when no regime exists at all (an unseeded database): the fallback percent applies. */
  regimeId: string | null;
  country: string;
  taxName: string;
  model: TaxModel;
  rateCode: string;
  percent: number;
  components: TaxComponent[];
  sellerId: string | null;
  placeOfSupply: PlaceOfSupply;
  serviceCode?: ServiceCode;
  pricesIncludeTax: boolean;
  zeroRated: boolean;
  fallback: boolean;
}

export interface DetermineTaxInput {
  serviceCountry: string;
  customerCountry?: string;
  customerState?: string;
  customerStateCode?: string;
  regimes: readonly RegimeRule[];
  sellers: readonly SellerRule[];
  override?: TaxOverride;
  /** Regime used when the service country has none (default AE). */
  defaultCountry?: string;
  /** Percent used when there is no regime at all (default 5). */
  fallbackPercent?: number;
}

export class TaxRuleError extends Error {
  constructor(
    readonly code: 'RATE_NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

const upper = (value: string | undefined | null) => (value ?? '').trim().toUpperCase();
const same = (a: string | undefined | null, b: string | undefined | null) => upper(a) === upper(b);

/** The registration that issues the invoice: the active one of the tax country, else the default, else any active one. */
export function pickSeller<T extends SellerRule>(sellers: readonly T[], country: string): T | null {
  const active = sellers.filter((seller) => seller.active);
  const local = active.filter((seller) => same(seller.country, country));
  return local.find((s) => s.isDefault) ?? local[0] ?? active.find((s) => s.isDefault) ?? active[0] ?? null;
}

/** Within the seller's state? Unknown on either side counts as within (a local supply is the normal case). */
export function isWithinSellerState(
  seller: Pick<SellerRule, 'state' | 'stateCode'> | null,
  supply: { state?: string; stateCode?: string },
): boolean {
  if (!seller) return true;
  if (supply.stateCode && seller.stateCode) return supply.stateCode.trim() === seller.stateCode.trim();
  if (supply.state && seller.state) return same(supply.state, seller.state);
  return true;
}

export function componentsFor(
  regime: Pick<RegimeRule, 'model' | 'taxName'>,
  percent: number,
  withinState: boolean,
): TaxComponent[] {
  if (regime.model === 'india_gst') {
    if (withinState) {
      const half = Math.round(percent * 5000) / 10_000;
      return [
        { code: 'CGST', label: 'CGST', percent: half },
        { code: 'SGST', label: 'SGST', percent: half },
      ];
    }
    return [{ code: 'IGST', label: 'IGST', percent }];
  }
  return [{ code: 'VAT', label: regime.taxName || 'VAT', percent }];
}

/**
 * Which tax applies to a supply, by the country where the service is delivered. Falls back to the default country's
 * regime (`fallback: true`), and to a plain percent when no regime exists yet.
 */
export function determineTax(input: DetermineTaxInput): TaxDetermination {
  const defaultCountry = upper(input.defaultCountry) || 'AE';
  const wanted = upper(input.override?.country) || upper(input.serviceCountry);
  const active = input.regimes.filter((regime) => regime.active);

  let regime = active.find((r) => same(r.country, wanted));
  let fallback = false;
  if (!regime) {
    fallback = true;
    regime = active.find((r) => same(r.country, defaultCountry));
  }

  const state = (input.override?.placeOfSupplyState ?? input.customerState)?.trim() || undefined;
  const stateCode = (input.override?.placeOfSupplyStateCode ?? input.customerStateCode)?.trim() || undefined;
  const supplyCountry = /^[A-Z]{2}$/.test(wanted) ? wanted : (regime?.country ?? defaultCountry);

  if (!regime) {
    const percent = input.fallbackPercent ?? 5;
    const seller = pickSeller(input.sellers, defaultCountry);
    return {
      regimeId: null,
      country: defaultCountry,
      taxName: 'VAT',
      model: 'single',
      rateCode: 'standard',
      percent,
      components: [{ code: 'VAT', label: 'VAT', percent }],
      sellerId: seller?.id ?? null,
      placeOfSupply: { country: supplyCountry, ...(state && { state }), ...(stateCode && { stateCode }) },
      pricesIncludeTax: false,
      zeroRated: percent === 0,
      fallback: true,
    };
  }

  const wantedRate = input.override?.rateCode?.trim();
  const rate = wantedRate
    ? regime.rates.find((r) => r.code === wantedRate)
    : (regime.rates.find((r) => r.isDefault) ?? regime.rates[0]);
  if (!rate) throw new TaxRuleError('RATE_NOT_FOUND', `${regime.country} has no tax rate "${wantedRate ?? 'default'}"`);

  const seller = pickSeller(input.sellers, regime.country);
  const withinState = regime.model !== 'india_gst' || isWithinSellerState(seller, { state, stateCode });
  return {
    regimeId: regime.id,
    country: regime.country,
    taxName: regime.taxName,
    model: regime.model,
    rateCode: rate.code,
    percent: rate.percent,
    components: componentsFor(regime, rate.percent, withinState),
    sellerId: seller?.id ?? null,
    placeOfSupply: { country: supplyCountry, ...(state && { state }), ...(stateCode && { stateCode }) },
    ...(regime.serviceCode && { serviceCode: { ...regime.serviceCode } }),
    pricesIncludeTax: regime.pricesIncludeTax,
    zeroRated: rate.percent === 0,
    fallback,
  };
}

// ------------------------------------------------------------------ money

export const toMinor = (amount: number): number => Math.round(amount * 100 + Math.sign(amount) * 1e-7);
export const fromMinor = (minor: number): number => minor / 100;

/** Tax on a tax-exclusive amount, rounded half up. */
export const taxOnNet = (netMinor: number, percent: number): number => Math.round((netMinor * percent) / 100 + 1e-7);

/** Net part of a tax-inclusive amount: `net = total / (1 + rate)`, rounded half up. */
export const netOfGross = (grossMinor: number, percent: number): number =>
  Math.round((grossMinor * 100) / (100 + percent) + 1e-7);

/** Splits a tax amount across components by their percentages (largest remainder: the parts always sum to `taxMinor`). */
export function splitTaxMinor(taxMinor: number, components: readonly Pick<TaxComponent, 'percent'>[]): number[] {
  if (components.length === 1) return [taxMinor];
  return allocate(taxMinor, components.map((component) => component.percent));
}

export interface ComponentAmount extends TaxComponent {
  /** The base the component was charged on (the same for every component of a document). */
  taxableMinor: number;
  taxMinor: number;
}

export interface TaxBreakdown {
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  components: ComponentAmount[];
}

/** Breakdown of a document whose net and tax are already known (a cart line, a stored booking). */
export function breakdownOf(
  netMinor: number,
  taxMinor: number,
  components: readonly TaxComponent[],
): TaxBreakdown {
  const parts = splitTaxMinor(taxMinor, components);
  return {
    netMinor,
    taxMinor,
    totalMinor: netMinor + taxMinor,
    components: components.map((component, index) => ({
      ...component,
      taxableMinor: netMinor,
      taxMinor: parts[index],
    })),
  };
}

/** Tax added on top of a tax-exclusive amount. */
export function exclusiveBreakdown(netMinor: number, determination: Pick<TaxDetermination, 'percent' | 'components'>): TaxBreakdown {
  return breakdownOf(netMinor, taxOnNet(netMinor, determination.percent), determination.components);
}

/** Tax extracted from a tax-inclusive total: the total never changes. */
export function inclusiveBreakdown(grossMinor: number, determination: Pick<TaxDetermination, 'percent' | 'components'>): TaxBreakdown {
  const net = netOfGross(grossMinor, determination.percent);
  return breakdownOf(net, grossMinor - net, determination.components);
}

/**
 * Splits the tax of one credit note across the invoice's components in proportion to the invoice, never above what
 * the component still has left, and exactly `taxMinor` in total (unless the invoice has less tax left than that).
 * The credit note that completes the invoice takes every remainder, so the credit notes add up to the invoice.
 */
export function splitCreditNoteTax(
  taxMinor: number,
  invoiceTaxMinor: readonly number[],
  creditedMinor: readonly number[],
): number[] {
  const remaining = invoiceTaxMinor.map((tax, i) => Math.max(0, tax - (creditedMinor[i] ?? 0)));
  const remainingTotal = remaining.reduce((a, b) => a + b, 0);
  const target = Math.min(Math.max(0, taxMinor), remainingTotal);
  if (target === remainingTotal) return remaining;
  const parts = allocate(target, [...invoiceTaxMinor]);
  let excess = 0;
  parts.forEach((part, i) => {
    if (part > remaining[i]) {
      excess += part - remaining[i];
      parts[i] = remaining[i];
    }
  });
  for (let i = 0; excess > 0 && i < 10_000; i++) {
    const at = i % parts.length;
    if (parts[at] < remaining[at]) {
      parts[at] += 1;
      excess -= 1;
    }
  }
  return parts;
}
