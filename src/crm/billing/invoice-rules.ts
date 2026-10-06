/** Pure helpers for invoice numbering and credit-note arithmetic (minor units, no I/O). */

const DUBAI_OFFSET_MS = 4 * 3_600_000;

/** Calendar year in the operating time zone (Asia/Dubai, UTC+4, no DST). */
export function operatingYear(now: Date): number {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).getUTCFullYear();
}

export type DocumentPrefix = 'INV' | 'CN';

/** INV-2026-000001 / CN-2026-000001. */
export function formatDocumentNumber(prefix: DocumentPrefix, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('sequence must be a positive integer');
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/** Counter key: one sequence per document type and year, so numbering restarts each January. */
export function counterKey(prefix: DocumentPrefix, year: number): string {
  return `${prefix.toLowerCase()}-${year}`;
}

/**
 * Tax portion of a (partial) refund: proportional to the booking's tax, rounded, and never more
 * than the tax not yet credited. The refund that completes the booking total takes the exact
 * remainder so the credit notes of one booking always add up to the invoice.
 */
export function creditNoteTaxMinor(input: {
  totalMinor: number;
  taxMinor: number;
  refundMinor: number;
  alreadyRefundedMinor: number;
  alreadyCreditedTaxMinor: number;
}): number {
  const { totalMinor, taxMinor, refundMinor, alreadyRefundedMinor, alreadyCreditedTaxMinor } = input;
  if (totalMinor <= 0 || taxMinor <= 0) return 0;
  const remainingTax = Math.max(0, taxMinor - alreadyCreditedTaxMinor);
  if (alreadyRefundedMinor + refundMinor >= totalMinor) return remainingTax;
  return Math.min(remainingTax, Math.round((taxMinor * refundMinor) / totalMinor));
}
