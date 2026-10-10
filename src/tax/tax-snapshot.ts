import { type TaxDetermination, breakdownOf, fromMinor } from './tax.rules';

/** The flat tax fields stored on a booking (see docs/BILLING_API.md "Booking additions"). */
export interface BookingTaxFields {
  taxCountry: string;
  taxRegimeId?: string;
  taxName: string;
  taxModel: string;
  taxRateCode: string;
  taxPercent: number;
  taxComponents: { code: string; label: string; percent: number; taxableAmount: number; taxAmount: number }[];
  taxPricesIncluded: boolean;
  taxPlaceOfSupply: { country: string; state?: string; stateCode?: string };
  taxServiceCode?: { label: string; value: string; description?: string };
  taxSellerId?: string;
  taxFallback: boolean;
}

/**
 * Snapshot of the tax rule and of the amounts it produced for one booking: `netMinor` is the taxable amount (after
 * discount) and `taxMinor` the tax actually charged; the components split that tax with the largest-remainder rule.
 */
export function bookingTaxFields(det: TaxDetermination, netMinor: number, taxMinor: number): BookingTaxFields {
  const breakdown = breakdownOf(netMinor, taxMinor, det.components);
  return {
    taxCountry: det.country,
    ...(det.regimeId && { taxRegimeId: det.regimeId }),
    taxName: det.taxName,
    taxModel: det.model,
    taxRateCode: det.rateCode,
    taxPercent: det.percent,
    taxComponents: breakdown.components.map((c) => ({
      code: c.code,
      label: c.label,
      percent: c.percent,
      taxableAmount: fromMinor(c.taxableMinor),
      taxAmount: fromMinor(c.taxMinor),
    })),
    taxPricesIncluded: det.pricesIncludeTax,
    taxPlaceOfSupply: det.placeOfSupply,
    ...(det.serviceCode && { taxServiceCode: det.serviceCode }),
    ...(det.sellerId && { taxSellerId: det.sellerId }),
    taxFallback: det.fallback,
  };
}
