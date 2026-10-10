/** Starting tax table (editable in the admin afterwards). Rates are configuration, not legal advice. */

const numbering = { prefix: 'INV', creditPrefix: 'CN', includeCountry: false, yearDigits: 4 as const, sequenceDigits: 6 };

const vat = (country: string, countryName: string, percent: number, extra: Record<string, unknown> = {}) => ({
  country,
  countryName,
  taxName: 'VAT',
  invoiceTitle: 'Tax Invoice',
  registrationLabel: 'VAT No',
  model: 'single' as const,
  rates: [
    { code: 'standard', label: `Standard ${percent}%`, percent, isDefault: true },
    { code: 'zero', label: 'Zero rated 0%', percent: 0, isDefault: false },
  ],
  pricesIncludeTax: false,
  numbering: { ...numbering },
  invoiceNotes: '',
  qr: 'none' as const,
  active: true,
  ...extra,
});

export const DEFAULT_REGIMES = [
  vat('AE', 'United Arab Emirates', 5, { registrationLabel: 'TRN', invoiceNotes: 'VAT registered in the UAE.' }),
  {
    country: 'IN',
    countryName: 'India',
    taxName: 'GST',
    invoiceTitle: 'Tax Invoice',
    registrationLabel: 'GSTIN',
    model: 'india_gst' as const,
    rates: [
      { code: 'gst5', label: 'GST 5%', percent: 5, isDefault: true },
      { code: 'gst12', label: 'GST 12%', percent: 12, isDefault: false },
      { code: 'gst18', label: 'GST 18%', percent: 18, isDefault: false },
      { code: 'zero', label: 'GST 0%', percent: 0, isDefault: false },
    ],
    serviceCode: { label: 'SAC', value: '998555', description: 'Tour operator services' },
    pricesIncludeTax: false,
    numbering: { prefix: 'INV', creditPrefix: 'CN', includeCountry: true, yearDigits: 2 as const, sequenceDigits: 6, maxLength: 16 },
    invoiceNotes: 'This is a computer generated invoice and does not require a signature.',
    qr: 'none' as const,
    active: true,
  },
  vat('SA', 'Saudi Arabia', 15, { registrationLabel: 'VAT No', qr: 'zatca' as const }),
  vat('GB', 'United Kingdom', 20),
  vat('DE', 'Germany', 19),
  vat('FR', 'France', 20),
  vat('ES', 'Spain', 21),
  vat('IT', 'Italy', 22),
  vat('NL', 'Netherlands', 21),
];
