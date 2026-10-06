import { counterKey, creditNoteTaxMinor, formatDocumentNumber, operatingYear } from './invoice-rules';

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
