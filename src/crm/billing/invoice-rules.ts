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

// ---------------------------------------------------------------- regime-driven numbering

export type DocumentType = DocumentPrefix;

/** The numbering every invoice used before regimes existed: INV-2026-000001 / CN-2026-000001. */
export interface NumberingFormat {
  prefix: string;
  creditPrefix: string;
  includeCountry: boolean;
  yearDigits: 2 | 4;
  sequenceDigits: number;
  maxLength?: number | null;
}

export const LEGACY_NUMBERING: NumberingFormat = {
  prefix: 'INV',
  creditPrefix: 'CN',
  includeCountry: false,
  yearDigits: 4,
  sequenceDigits: 6,
};

/** `INV-2026-` / `INV-IN26-`: everything before the sequence. One counter (one gap-free series) per seller and series. */
export function numberSeries(format: NumberingFormat, type: DocumentType, country: string, year: number): string {
  const prefix = type === 'INV' ? format.prefix : format.creditPrefix;
  const yy = format.yearDigits === 2 ? String(year).slice(-2) : String(year);
  return `${prefix}-${format.includeCountry ? country.toUpperCase() : ''}${yy}-`;
}

/** Number of a document in its series, e.g. `INV-IN26-000001`. Never longer than `maxLength`. */
export function formatSeriesNumber(
  format: NumberingFormat,
  type: DocumentType,
  country: string,
  year: number,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('sequence must be a positive integer');
  const number = numberSeries(format, type, country, year) + String(sequence).padStart(format.sequenceDigits, '0');
  if (format.maxLength && number.length > format.maxLength) {
    throw new Error(`document number ${number} is longer than the ${format.maxLength} characters this regime allows`);
  }
  return number;
}

/** True when a regime's numbering can always produce numbers within its `maxLength` (checked with the longest prefix). */
export function numberingFits(format: NumberingFormat, country: string): boolean {
  if (!format.maxLength) return true;
  const longest = Math.max(
    numberSeries(format, 'INV', country, 2099).length,
    numberSeries(format, 'CN', country, 2099).length,
  );
  return longest + format.sequenceDigits <= format.maxLength;
}

/**
 * Counter id of a series. The seller that already issued numbers before regimes existed (`legacy`) keeps the original
 * `inv-2026` / `cn-2026` counters for the original format, so its sequence continues without a gap or a repeat.
 */
export function seriesCounterKey(scope: string, series: string): string {
  const legacy = /^(INV|CN)-(\d{4})-$/.exec(series);
  if (scope === 'legacy' && legacy) return counterKey(legacy[1] as DocumentPrefix, Number(legacy[2]));
  return `${scope}|${series}`;
}

// ---------------------------------------------------------------- invoice e-mail retries

export const MAX_EMAIL_ATTEMPTS = 5;

/** Wait before the next try after `attempts` failed sends: 5 min, 20 min, 80 min, ~5.3 h (then it stops at 5). */
export function emailBackoffMs(attempts: number): number {
  return 5 * 60_000 * 4 ** Math.max(0, Math.min(attempts, MAX_EMAIL_ATTEMPTS) - 1);
}

/** Error text safe to store and show to staff: no e-mail addresses, one line, short. */
export function safeEmailError(message: string): string {
  return message.replace(/[^\s<>"',;]+@[^\s<>"',;]+/g, '[address]').replace(/\s+/g, ' ').trim().slice(0, 200);
}
