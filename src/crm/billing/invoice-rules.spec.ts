import {
  LEGACY_NUMBERING,
  counterKey,
  creditNoteTaxMinor,
  emailBackoffMs,
  formatDocumentNumber,
  formatSeriesNumber,
  numberSeries,
  numberingFits,
  operatingYear,
  safeEmailError,
  seriesCounterKey,
} from './invoice-rules';

describe('document numbers', () => {
  it('formats INV-YYYY-000001 and CN-YYYY-000001', () => {
    expect(formatDocumentNumber('INV', 2026, 1)).toBe('INV-2026-000001');
    expect(formatDocumentNumber('INV', 2026, 123456)).toBe('INV-2026-123456');
    expect(formatDocumentNumber('CN', 2027, 42)).toBe('CN-2027-000042');
    expect(() => formatDocumentNumber('INV', 2026, 0)).toThrow();
    expect(() => formatDocumentNumber('INV', 2026, 1.5)).toThrow();
  });

  it('keeps one counter per type and year, in Dubai time', () => {
    expect(counterKey('INV', 2026)).toBe('inv-2026');
    expect(counterKey('CN', 2026)).toBe('cn-2026');
    // 20:30 UTC on 31 Dec is already 00:30 on 1 Jan in Dubai.
    expect(operatingYear(new Date('2026-12-31T20:30:00Z'))).toBe(2027);
    expect(operatingYear(new Date('2026-12-31T19:30:00Z'))).toBe(2026);
  });
});

describe('credit note tax', () => {
  const base = { totalMinor: 10500, taxMinor: 500, alreadyRefundedMinor: 0, alreadyCreditedTaxMinor: 0 };
  it('is proportional for a partial refund', () => {
    expect(creditNoteTaxMinor({ ...base, refundMinor: 5250 })).toBe(250);
  });
  it('takes the exact remainder on the last refund so credit notes add up to the invoice', () => {
    const first = creditNoteTaxMinor({ ...base, refundMinor: 3333 });
    const second = creditNoteTaxMinor({ ...base, refundMinor: 7167, alreadyRefundedMinor: 3333, alreadyCreditedTaxMinor: first });
    expect(first + second).toBe(500);
  });
  it('is zero without tax and never exceeds the remaining tax', () => {
    expect(creditNoteTaxMinor({ ...base, taxMinor: 0, refundMinor: 1000 })).toBe(0);
    expect(creditNoteTaxMinor({ ...base, refundMinor: 10500, alreadyCreditedTaxMinor: 400 })).toBe(100);
  });
});

describe('regime numbering', () => {
  const india = { prefix: 'INV', creditPrefix: 'CN', includeCountry: true, yearDigits: 2 as const, sequenceDigits: 6, maxLength: 16 };

  it('keeps the legacy UAE format and counters unchanged', () => {
    expect(formatSeriesNumber(LEGACY_NUMBERING, 'INV', 'AE', 2026, 7)).toBe('INV-2026-000007');
    expect(formatSeriesNumber(LEGACY_NUMBERING, 'INV', 'AE', 2026, 7)).toBe(formatDocumentNumber('INV', 2026, 7));
    expect(seriesCounterKey('legacy', numberSeries(LEGACY_NUMBERING, 'INV', 'AE', 2026))).toBe(counterKey('INV', 2026));
    expect(seriesCounterKey('legacy', numberSeries(LEGACY_NUMBERING, 'CN', 'AE', 2026))).toBe('cn-2026');
  });

  it('formats India numbers within 16 characters and credit notes with their own prefix', () => {
    expect(formatSeriesNumber(india, 'INV', 'IN', 2026, 1)).toBe('INV-IN26-000001');
    expect(formatSeriesNumber(india, 'CN', 'IN', 2026, 12)).toBe('CN-IN26-000012');
    expect(numberingFits(india, 'IN')).toBe(true);
  });

  it('refuses a number longer than the regime allows and rejects numbering that can overflow', () => {
    expect(() => formatSeriesNumber(india, 'INV', 'IN', 2026, 10_000_000)).toThrow(/longer than/);
    expect(numberingFits({ ...india, yearDigits: 4 }, 'IN')).toBe(false);
    expect(numberingFits({ ...india, sequenceDigits: 8 }, 'IN')).toBe(false);
    expect(numberingFits({ ...india, maxLength: null, yearDigits: 4 }, 'IN')).toBe(true);
  });

  it('gives every seller and series its own counter, never reusing legacy keys for other formats', () => {
    const series = numberSeries(india, 'INV', 'IN', 2026);
    expect(series).toBe('INV-IN26-');
    expect(seriesCounterKey('legacy', series)).toBe('legacy|INV-IN26-');
    expect(seriesCounterKey('seller-1', numberSeries(LEGACY_NUMBERING, 'INV', 'AE', 2026))).toBe('seller-1|INV-2026-');
    expect(seriesCounterKey('seller-1', series)).not.toBe(seriesCounterKey('seller-2', series));
  });
});

describe('invoice e-mail retries', () => {
  it('backs off 5 min, 20 min, 80 min, ~5.3 h', () => {
    expect([1, 2, 3, 4].map(emailBackoffMs)).toEqual([300_000, 1_200_000, 4_800_000, 19_200_000]);
  });

  it('stores no e-mail addresses in the last error', () => {
    expect(safeEmailError('Recipient ada@example.com rejected: 550 mailbox <bob@example.org> unknown')).toBe(
      'Recipient [address] rejected: 550 mailbox <[address]> unknown',
    );
    expect(safeEmailError('x'.repeat(500))).toHaveLength(200);
  });
});
