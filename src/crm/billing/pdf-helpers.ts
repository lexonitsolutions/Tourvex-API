/** Shared helpers of the PDF renderers. */

/** The built-in PDF fonts only cover Latin-1; anything else would print as garbage. */
export const safe = (text: string | undefined | null): string =>
  Array.from(text ?? '')
    .map((char) => {
      const code = char.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? char : '?';
    })
    .join('');

export const money = (value: number, currency: string) =>
  `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Calendar date in the operating time zone (Asia/Dubai, UTC+4). */
export const dateText = (date: Date) => new Date(date.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);

export const NAVY = '#0f2454';
export const MUTED = '#66728f';
export const LINE = '#e3e8f0';
