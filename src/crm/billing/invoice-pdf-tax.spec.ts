import { type InvoicePdfModel, renderInvoicePdf } from './invoice-pdf';
import { layoutOf } from './invoice-pdf-tax';

/** Text of an uncompressed pdfkit document: the hex / literal strings of the text operators, in order. */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const out: string[] = [];
  for (const match of raw.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|\(((?:[^)\\]|\\.)*)\)\s*Tj/g)) {
    if (match[1] !== undefined) {
      out.push([...match[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join(''));
    } else if (match[2] !== undefined) {
      out.push(Buffer.from(match[2], 'hex').toString('latin1'));
    } else {
      out.push(match[3]);
    }
  }
  return out.join('\n');
}

const seller = {
  legalName: 'Karnish Tourism LLC',
  address: 'Office 1, Dubai, UAE',
  taxNumber: '100123456700003',
  registrationNumber: '100123456700003',
  email: 'help@example.com',
  phone: '+971 4 000 0000',
};
const common = {
  kind: 'invoice' as const,
  number: 'INV-2026-000001',
  issuedAt: new Date('2026-10-05T08:00:00Z'),
  status: 'paid',
  currency: 'AED',
  customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
  bookingReference: 'TVX-2026-1A2B3C4D',
  lines: [{ label: 'Desert safari (sharing)', qty: 2, unitAmount: 100, total: 200 }],
  discount: 0,
};

const uae: InvoicePdfModel = {
  ...common,
  seller,
  title: 'Tax Invoice',
  buyer: { name: 'Ada Lovelace', email: 'ada@example.com', address: '12 Example Street, London' },
  subtotal: 200,
  tax: 10,
  taxPercent: 5,
  total: 210,
  taxInfo: {
    country: 'AE', taxName: 'VAT', model: 'single', rateCode: 'standard', percent: 5, pricesIncludeTax: false,
    registrationLabel: 'TRN',
    components: [{ code: 'VAT', label: 'VAT', percent: 5, taxableAmount: 200, taxAmount: 10 }],
  },
};

const india: InvoicePdfModel = {
  ...common,
  number: 'INV-IN26-000001',
  currency: 'INR',
  seller: { ...seller, legalName: 'Karnish India Pvt Ltd', registrationNumber: '32AABCK1234F1Z5', taxNumber: '32AABCK1234F1Z5', state: 'Kerala', stateCode: '32' },
  title: 'Tax Invoice',
  buyer: { name: 'Ravi Kumar', email: 'ravi@example.com', registrationNumber: '27AAACR5055K1Z7', state: 'Maharashtra', stateCode: '27' },
  lines: [{ label: 'Munnar tour', qty: 1, unitAmount: 9999, total: 9999 }],
  subtotal: 9999,
  tax: 1800,
  total: 11799,
  taxInfo: {
    country: 'IN', taxName: 'GST', model: 'india_gst', rateCode: 'gst18', percent: 18, pricesIncludeTax: false,
    registrationLabel: 'GSTIN', serviceCode: { label: 'SAC', value: '998555', description: 'Tour operator services' },
    placeOfSupply: { country: 'IN', state: 'Maharashtra', stateCode: '27' },
    components: [{ code: 'IGST', label: 'IGST', percent: 18, taxableAmount: 9999, taxAmount: 1800 }],
  },
};

describe('tax invoice layouts', () => {
  it('picks the layout from the tax snapshot', () => {
    expect(layoutOf({ country: 'AE', model: 'single' })).toBe('uae');
    expect(layoutOf({ country: 'IN', model: 'india_gst' })).toBe('india');
    expect(layoutOf({ country: 'GB', model: 'single' })).toBe('generic');
  });

  it('renders the UAE style tax invoice with TRN, buyer, VAT breakdown and total', async () => {
    const pdf = await renderInvoicePdf(uae, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    for (const expected of [
      'TAX INVOICE', 'INV-2026-000001', 'TRN: 100123456700003', 'Karnish Tourism LLC', 'Ada Lovelace', '12 Example Street, London',
      '2026-10-05', 'Desert safari (sharing)', 'UNIT PRICE (EX VAT)', 'VAT %', 'VAT 5%', 'AED 10.00', 'Total (AED)', 'AED 210.00',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('renders the India style invoice with GSTIN, state codes, SAC, IGST columns and amount in words', async () => {
    const text = pdfText(await renderInvoicePdf(india, { compress: false }));
    for (const expected of [
      'GSTIN: 32AABCK1234F1Z5', 'GSTIN: 27AAACR5055K1Z7', 'State code 32', 'Place of supply: Maharashtra (27)', 'SAC', '998555',
      'IGST %', 'IGST AMT', 'IGST 18%', 'Amount in words: Rupees Eleven Thousand Seven Hundred and Ninety Nine Only', 'computer generated',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('renders CGST and SGST columns within the seller state', async () => {
    const split: InvoicePdfModel = {
      ...india,
      taxInfo: {
        ...india.taxInfo!,
        components: [
          { code: 'CGST', label: 'CGST', percent: 9, taxableAmount: 9999, taxAmount: 900 },
          { code: 'SGST', label: 'SGST', percent: 9, taxableAmount: 9999, taxAmount: 900 },
        ],
      },
    };
    const text = pdfText(await renderInvoicePdf(split, { compress: false }));
    for (const expected of ['CGST %', 'CGST AMT', 'SGST %', 'SGST AMT', 'CGST 9%', 'SGST 9%']) expect(text).toContain(expected);
    expect(text).not.toContain('IGST');
  });

  it('renders the generic VAT layout and a credit note as deductions', async () => {
    const generic: InvoicePdfModel = {
      ...uae,
      seller: { ...seller, registrationNumber: 'GB123456789' },
      taxInfo: { ...uae.taxInfo!, country: 'GB', percent: 20, registrationLabel: 'VAT No', components: [{ code: 'VAT', label: 'VAT', percent: 20, taxableAmount: 200, taxAmount: 40 }] },
      tax: 40,
      total: 240,
    };
    const text = pdfText(await renderInvoicePdf(generic, { compress: false }));
    expect(text).toContain('VAT No: GB123456789');
    expect(text).toContain('UNIT PRICE (EX VAT)');
    const credit = pdfText(await renderInvoicePdf({ ...uae, kind: 'credit_note', number: 'CN-2026-000001', title: 'Credit Note', relatedInvoiceNumber: 'INV-2026-000001', reason: 'Cancelled' }, { compress: false }));
    for (const expected of ['CREDIT NOTE', 'Against invoice: INV-2026-000001', 'Total refunded (AED)', '-210.00', 'Reason: Cancelled']) expect(credit).toContain(expected);
  });

  it('adds the ZATCA QR for qr: zatca regimes and survives non-Latin text', async () => {
    const sa: InvoicePdfModel = {
      ...uae,
      currency: 'SAR',
      customer: { name: 'محمد', email: 'm@example.com' },
      buyer: { name: 'محمد', email: 'm@example.com' },
      taxInfo: { ...uae.taxInfo!, country: 'SA', percent: 15, qr: 'zatca', registrationLabel: 'VAT No', components: [{ code: 'VAT', label: 'VAT', percent: 15, taxableAmount: 200, taxAmount: 30 }] },
      tax: 30,
      total: 230,
    };
    const plain = await renderInvoicePdf({ ...sa, taxInfo: { ...sa.taxInfo!, qr: 'none' } });
    const withQr = await renderInvoicePdf(sa);
    expect(withQr.subarray(0, 5).toString()).toBe('%PDF-');
    expect(withQr.length).toBeGreaterThan(plain.length);
    expect(pdfText(await renderInvoicePdf(sa, { compress: false }))).toContain('ZATCA e-invoice QR');
  });

  it('keeps legacy documents (no tax snapshot) on the old layout', async () => {
    const legacy = pdfText(await renderInvoicePdf({ ...common, seller, subtotal: 200, tax: 10, taxPercent: 5, total: 210 }, { compress: false }));
    expect(legacy).toContain('TAX INVOICE');
    expect(legacy).toContain('Taxes & fees (5%)');
  });
});
