import { creditNoteTaxMinor } from '../crm/billing/invoice-rules';
import { DEFAULT_REGIMES } from './tax.defaults';
import {
  type RegimeRule,
  type SellerRule,
  TaxRuleError,
  determineTax,
  exclusiveBreakdown,
  inclusiveBreakdown,
  netOfGross,
  splitCreditNoteTax,
  splitTaxMinor,
  taxOnNet,
} from './tax.rules';

const regimes: RegimeRule[] = DEFAULT_REGIMES.map((r, i) => ({
  ...(r as unknown as RegimeRule),
  id: `regime-${i}`,
  invoiceNotes: '',
  serviceCode: (r as { serviceCode?: RegimeRule['serviceCode'] }).serviceCode,
}));
const sellers: SellerRule[] = [
  { id: 'seller-ae', country: 'AE', isDefault: true, active: true },
  { id: 'seller-in', country: 'IN', state: 'Kerala', stateCode: '32', isDefault: false, active: true },
];
const base = { regimes, sellers };

describe('determineTax', () => {
  it('taxes a UAE service with the AE default rate and the AE seller', () => {
    const det = determineTax({ ...base, serviceCountry: 'AE' });
    expect(det).toMatchObject({
      country: 'AE', taxName: 'VAT', model: 'single', rateCode: 'standard', percent: 5, sellerId: 'seller-ae',
      zeroRated: false, fallback: false, pricesIncludeTax: false,
    });
    expect(det.components).toEqual([{ code: 'VAT', label: 'VAT', percent: 5 }]);
  });

  it('is decided by where the service is delivered, not where the customer lives', () => {
    const det = determineTax({ ...base, serviceCountry: 'IN', customerCountry: 'AE' });
    expect(det.country).toBe('IN');
    expect(det.fallback).toBe(false);
  });

  it('falls back to the default country regime when the service country has none', () => {
    const det = determineTax({ ...base, serviceCountry: 'JP' });
    expect(det).toMatchObject({ country: 'AE', percent: 5, fallback: true });
    expect(det.placeOfSupply.country).toBe('JP');
  });

  it('honours a different default country and ignores inactive regimes', () => {
    const inactive = regimes.map((r) => (r.country === 'FR' ? { ...r, active: false } : r));
    expect(determineTax({ regimes: inactive, sellers, serviceCountry: 'FR', defaultCountry: 'GB' })).toMatchObject({
      country: 'GB', percent: 20, fallback: true,
    });
    expect(determineTax({ ...base, serviceCountry: 'de' })).toMatchObject({ country: 'DE', percent: 19 });
  });

  it('uses the fallback percent when no regime exists at all', () => {
    const det = determineTax({ regimes: [], sellers: [], serviceCountry: 'AE', fallbackPercent: 7 });
    expect(det).toMatchObject({ regimeId: null, country: 'AE', percent: 7, fallback: true, sellerId: null });
    expect(det.components).toEqual([{ code: 'VAT', label: 'VAT', percent: 7 }]);
  });

  it('splits India GST into CGST + SGST within the seller state and IGST between states', () => {
    const within = determineTax({ ...base, serviceCountry: 'IN', customerStateCode: '32' });
    expect(within.components).toEqual([
      { code: 'CGST', label: 'CGST', percent: 2.5 },
      { code: 'SGST', label: 'SGST', percent: 2.5 },
    ]);
    expect(within.serviceCode).toMatchObject({ label: 'SAC', value: '998555' });
    const withinByName = determineTax({ ...base, serviceCountry: 'IN', customerState: 'kerala' });
    expect(withinByName.components.map((c) => c.code)).toEqual(['CGST', 'SGST']);
    const between = determineTax({ ...base, serviceCountry: 'IN', customerStateCode: '27', override: { rateCode: 'gst18' } });
    expect(between.components).toEqual([{ code: 'IGST', label: 'IGST', percent: 18 }]);
    expect(between.placeOfSupply).toEqual({ country: 'IN', stateCode: '27' });
  });

  it('treats an unknown place of supply as within the seller state', () => {
    expect(determineTax({ ...base, serviceCountry: 'IN' }).components.map((c) => c.code)).toEqual(['CGST', 'SGST']);
  });

  it('lets staff override the country, the rate and the place of supply', () => {
    const det = determineTax({
      ...base,
      serviceCountry: 'AE',
      override: { country: 'IN', rateCode: 'gst12', placeOfSupplyState: 'Tamil Nadu', placeOfSupplyStateCode: '33' },
    });
    expect(det).toMatchObject({ country: 'IN', rateCode: 'gst12', percent: 12 });
    expect(det.components).toEqual([{ code: 'IGST', label: 'IGST', percent: 12 }]);
    expect(det.placeOfSupply).toEqual({ country: 'IN', state: 'Tamil Nadu', stateCode: '33' });
  });

  it('supports zero rated supplies and rejects an unknown rate', () => {
    const zero = determineTax({ ...base, serviceCountry: 'AE', override: { rateCode: 'zero' } });
    expect(zero).toMatchObject({ percent: 0, zeroRated: true });
    expect(() => determineTax({ ...base, serviceCountry: 'AE', override: { rateCode: 'nope' } })).toThrow(TaxRuleError);
  });

  it('falls back to the default seller when the tax country has no registration', () => {
    expect(determineTax({ ...base, serviceCountry: 'GB' }).sellerId).toBe('seller-ae');
    expect(determineTax({ ...base, serviceCountry: 'IN' }).sellerId).toBe('seller-in');
  });
});

describe('money split rules', () => {
  it('adds UAE VAT 5% on a tax-exclusive amount', () => {
    const det = determineTax({ ...base, serviceCountry: 'AE' });
    expect(exclusiveBreakdown(10_000, det)).toMatchObject({ netMinor: 10_000, taxMinor: 500, totalMinor: 10_500 });
    // 33.33 -> 1.6665 rounds half up to 1.67
    expect(exclusiveBreakdown(3_333, det)).toMatchObject({ taxMinor: 167, totalMinor: 3_500 });
  });

  it('splits India 5% / 12% / 18% into CGST + SGST that always add up, including the odd paisa', () => {
    const intra = (rateCode: string) => determineTax({ ...base, serviceCountry: 'IN', override: { rateCode } });
    const five = exclusiveBreakdown(1_010, intra('gst5')); // 10.10 -> 0.505 -> 0.51 (odd paisa)
    expect(five.taxMinor).toBe(51);
    expect(five.components.map((c) => c.taxMinor)).toEqual([26, 25]);
    const twelve = exclusiveBreakdown(9_999, intra('gst12'));
    expect(twelve.taxMinor).toBe(1_200);
    expect(twelve.components.map((c) => c.taxMinor)).toEqual([600, 600]);
    const eighteen = exclusiveBreakdown(10_001, intra('gst18')); // 1800.18 -> 1800
    expect(eighteen.components.reduce((s, c) => s + c.taxMinor, 0)).toBe(eighteen.taxMinor);
    for (const breakdown of [five, twelve, eighteen]) {
      expect(breakdown.totalMinor).toBe(breakdown.netMinor + breakdown.taxMinor);
      for (const c of breakdown.components) expect(c.taxableMinor).toBe(breakdown.netMinor);
    }
  });

  it('charges IGST as one component with the full rate', () => {
    const det = determineTax({ ...base, serviceCountry: 'IN', customerStateCode: '27', override: { rateCode: 'gst18' } });
    const b = exclusiveBreakdown(12_345, det);
    expect(b.components).toHaveLength(1);
    expect(b.components[0]).toMatchObject({ code: 'IGST', taxMinor: b.taxMinor });
    expect(b.taxMinor).toBe(2_222); // 2222.1 rounds down
  });

  it('keeps zero rated amounts untaxed', () => {
    const det = determineTax({ ...base, serviceCountry: 'IN', override: { rateCode: 'zero' } });
    const b = exclusiveBreakdown(5_000, det);
    expect(b).toMatchObject({ taxMinor: 0, totalMinor: 5_000 });
    expect(b.components.map((c) => c.taxMinor)).toEqual([0, 0]);
  });

  it('extracts tax from a tax-inclusive total without changing the total', () => {
    const det = determineTax({ ...base, serviceCountry: 'AE' });
    expect(inclusiveBreakdown(10_500, det)).toMatchObject({ netMinor: 10_000, taxMinor: 500, totalMinor: 10_500 });
    const odd = inclusiveBreakdown(10_000, det); // 100.00 / 1.05 = 95.238...
    expect(odd).toMatchObject({ netMinor: 9_524, taxMinor: 476, totalMinor: 10_000 });
    const india = inclusiveBreakdown(11_800, determineTax({ ...base, serviceCountry: 'IN', override: { rateCode: 'gst18' } }));
    expect(india).toMatchObject({ netMinor: 10_000, taxMinor: 1_800, totalMinor: 11_800 });
    expect(india.components.map((c) => c.taxMinor)).toEqual([900, 900]);
    expect(netOfGross(1_001, 0)).toBe(1_001);
  });

  it('splits tax by largest remainder so parts sum to the total', () => {
    expect(splitTaxMinor(5, [{ percent: 2.5 }, { percent: 2.5 }])).toEqual([3, 2]);
    expect(splitTaxMinor(7, [{ percent: 9 }])).toEqual([7]);
    expect(splitTaxMinor(0, [{ percent: 0 }, { percent: 0 }])).toEqual([0, 0]);
    expect(taxOnNet(0, 5)).toBe(0);
  });
});

describe('credit notes of one booking add up exactly to its invoice', () => {
  // Deterministic pseudo random numbers (no flaky tests).
  let seed = 42;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };

  function refundAll(invoiceTaxByComponent: number[], taxMinor: number, totalMinor: number, refunds: number[]) {
    const credited = invoiceTaxByComponent.map(() => 0);
    let alreadyRefunded = 0;
    let creditedTax = 0;
    let creditedNet = 0;
    for (const refund of refunds) {
      let tax = creditNoteTaxMinor({
        totalMinor, taxMinor, refundMinor: refund, alreadyRefundedMinor: alreadyRefunded, alreadyCreditedTaxMinor: creditedTax,
      });
      const parts = splitCreditNoteTax(tax, invoiceTaxByComponent, credited);
      tax = parts.reduce((a, b) => a + b, 0);
      parts.forEach((part, i) => (credited[i] += part));
      creditedTax += tax;
      creditedNet += refund - tax;
      alreadyRefunded += refund;
    }
    return { credited, creditedTax, creditedNet };
  }

  it('across several partial refunds of an India invoice (CGST + SGST)', () => {
    const det = determineTax({ ...base, serviceCountry: 'IN', override: { rateCode: 'gst18' } });
    const inv = exclusiveBreakdown(9_999, det);
    const result = refundAll(inv.components.map((c) => c.taxMinor), inv.taxMinor, inv.totalMinor, [3_000, 3_333, 4_000, inv.totalMinor - 10_333]);
    expect(result.credited).toEqual(inv.components.map((c) => c.taxMinor));
    expect(result.creditedTax).toBe(inv.taxMinor);
    expect(result.creditedNet).toBe(inv.netMinor);
  });

  it('for 300 random invoices and refund splits (UAE, India intra, India inter)', () => {
    for (let n = 0; n < 300; n++) {
      const options = [
        { serviceCountry: 'AE' as const },
        { serviceCountry: 'IN' as const, override: { rateCode: ['gst5', 'gst12', 'gst18'][n % 3] } },
        { serviceCountry: 'IN' as const, customerStateCode: '27', override: { rateCode: ['gst5', 'gst12', 'gst18'][n % 3] } },
      ][n % 3];
      const det = determineTax({ ...base, ...options });
      const inv = exclusiveBreakdown(100 + Math.floor(rand() * 2_000_000), det);
      const cuts = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => Math.floor(rand() * inv.totalMinor)).sort((a, b) => a - b);
      const bounds = [0, ...cuts, inv.totalMinor];
      const refunds = bounds.slice(1).map((b, i) => b - bounds[i]).filter((r) => r > 0);
      const result = refundAll(inv.components.map((c) => c.taxMinor), inv.taxMinor, inv.totalMinor, refunds);
      expect(result.credited).toEqual(inv.components.map((c) => c.taxMinor));
      expect(result.creditedTax).toBe(inv.taxMinor);
      expect(result.creditedNet).toBe(inv.netMinor);
    }
  });

  it('never gives a component more than it has left', () => {
    expect(splitCreditNoteTax(10, [5, 5], [5, 0])).toEqual([0, 5]);
    expect(splitCreditNoteTax(3, [100, 0], [0, 0])).toEqual([3, 0]);
    expect(splitCreditNoteTax(99, [4, 6], [0, 0])).toEqual([4, 6]);
  });
});
