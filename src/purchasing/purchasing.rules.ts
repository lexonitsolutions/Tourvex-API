import { addDays } from '../catalog/activity-booking.utils';
import { expandDates } from '../stock/stock.rules';

/** Pure purchasing math: money in integer minor units (2 decimals), dates are YYYY-MM-DD. */

export const toMinor = (amount: number) => Math.round((amount + Number.EPSILON) * 100);
export const fromMinor = (minor: number) => minor / 100;

export interface LineInput {
  quantity: number;
  dateFrom: string;
  dateTo: string;
  weekdays?: readonly number[];
  unitCost: number;
  taxPercent?: number;
}

export interface LineFigures {
  dates: string[];
  /** quantity x number of matching dates. */
  totalUnits: number;
  lineTotal: number;
  taxAmount: number;
}

/**
 * Dates a line adds units to, the units in total, its total (`totalUnits x unitCost`) and its tax.
 * Throws `{ code }` (INVALID_DATE, INVALID_RANGE, RANGE_TOO_LARGE, NO_MATCHING_DAYS) from `expandDates`.
 */
export function computeLine(line: LineInput): LineFigures {
  const dates = expandDates(line.dateFrom, line.dateTo, line.weekdays);
  const totalUnits = line.quantity * dates.length;
  const lineMinor = Math.round(totalUnits * toMinor(line.unitCost));
  const taxMinor = line.taxPercent ? Math.round((lineMinor * Math.round(line.taxPercent * 1000)) / 100_000) : 0;
  return { dates, totalUnits, lineTotal: fromMinor(lineMinor), taxAmount: fromMinor(taxMinor) };
}

export function computeTotals(lines: Array<Pick<LineFigures, 'lineTotal' | 'taxAmount'>>) {
  const subtotal = lines.reduce((sum, line) => sum + toMinor(line.lineTotal), 0);
  const tax = lines.reduce((sum, line) => sum + toMinor(line.taxAmount), 0);
  return { subtotal: fromMinor(subtotal), taxTotal: fromMinor(tax), total: fromMinor(subtotal + tax) };
}

/** `PUR-2026-000001`; numbers past the width simply grow. */
export const formatPurchaseNumber = (year: number | string, seq: number) => `PUR-${year}-${String(seq).padStart(6, '0')}`;

export const purchaseCounterName = (year: number | string) => `purchase-${year}`;

/** Due date from the supplier's payment terms, or undefined when the terms are 0. */
export function dueDateFor(invoiceDate: string, paymentTermsDays: number): string | undefined {
  return paymentTermsDays > 0 ? addDays(invoiceDate, paymentTermsDays) : undefined;
}

/** A received (unpaid) purchase is overdue the day after its due date. */
export const isOverdue = (status: string, dueDate: string | undefined, today: string) =>
  status === 'received' && Boolean(dueDate) && (dueDate as string) < today;

/** The last cost per item across lines: later lines win. */
export function lastUnitCosts(lines: Array<{ itemId: string; unitCost: number }>): Map<string, number> {
  const costs = new Map<string, number>();
  for (const line of lines) costs.set(line.itemId, line.unitCost);
  return costs;
}
