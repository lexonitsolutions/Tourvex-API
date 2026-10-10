const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' and' : ''}`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

/** Whole number in the Indian system (thousand, lakh, crore). */
export function integerInWords(value: number): string {
  if (value === 0) return 'Zero';
  const units: [number, string][] = [
    [10_000_000, 'Crore'],
    [100_000, 'Lakh'],
    [1000, 'Thousand'],
  ];
  const parts: string[] = [];
  let rest = value;
  for (const [size, name] of units) {
    if (rest >= size) {
      const count = Math.floor(rest / size);
      parts.push(`${integerInWords(count)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "Rupees One Thousand Two Hundred and Fifty Paise Only" style text for an invoice total (minor units in). */
export function amountInWords(totalMinor: number, currency: string): string {
  const names: Record<string, [string, string]> = {
    INR: ['Rupees', 'Paise'],
    AED: ['Dirhams', 'Fils'],
    SAR: ['Riyals', 'Halalas'],
    USD: ['Dollars', 'Cents'],
    GBP: ['Pounds', 'Pence'],
    EUR: ['Euros', 'Cents'],
  };
  const [major, minor] = names[currency.toUpperCase()] ?? [currency.toUpperCase(), 'Minor units'];
  const whole = Math.floor(totalMinor / 100);
  const fraction = totalMinor % 100;
  const text = `${major} ${integerInWords(whole)}${fraction ? ` and ${integerInWords(fraction)} ${minor}` : ''}`;
  return `${text} Only`;
}
