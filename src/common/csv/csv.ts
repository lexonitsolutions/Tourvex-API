import type { Response } from 'express';

/** Hard cap for every admin CSV export. */
export const CSV_MAX_ROWS = 10_000;
const UTF8_BOM = String.fromCharCode(0xfeff);

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * One CSV cell. Strings that a spreadsheet would execute as a formula (start with = + - @, tab or
 * carriage return) get a leading apostrophe. Real numbers are left alone (a negative number is not
 * a formula). Cells containing a comma, quote or line break are quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = typeof value === 'string' ? value : '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/**
 * Streams rows as a CSV download without buffering the file: the header goes out first, then one
 * row at a time with back-pressure. At most `maxRows` (default 10,000) rows are written and the cap
 * is announced in the `X-Export-Row-Cap` header. The result reports whether the source had more
 * rows than the cap (callers can audit it); headers are already sent by then, so it is not a header.
 */
export async function streamCsv<T>(
  res: Response,
  filename: string,
  columns: readonly CsvColumn<T>[],
  rows: AsyncIterable<T> | Iterable<T>,
  maxRows = CSV_MAX_ROWS,
): Promise<{ written: number; truncated: boolean }> {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Export-Row-Cap', String(maxRows));

  const write = async (chunk: string) => {
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => res.once('drain', () => resolve()));
    }
  };

  // Excel needs the BOM to read UTF-8.
  await write(`${UTF8_BOM}${csvRow(columns.map((column) => column.header))}`);
  let written = 0;
  let truncated = false;
  for await (const row of rows) {
    if (written >= maxRows) {
      truncated = true;
      break;
    }
    await write(csvRow(columns.map((column) => column.value(row))));
    written++;
  }
  res.end();
  return { written, truncated };
}
