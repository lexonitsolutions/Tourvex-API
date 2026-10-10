/**
 * HTML + plain-text bodies of the transactional e-mails. Every dynamic value is HTML-escaped (and header-safe) here,
 * so callers pass raw strings and templates never concatenate unescaped content.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** No line breaks in anything that ends up in a header (subject), and a sane length. */
export const singleLine = (value: string | number | null | undefined, max = 150): string =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function layout(brand: string, heading: string, bodyHtml: string, footer: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2454">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:28px">
<tr><td style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#66728f">${escapeHtml(brand)}</td></tr>
<tr><td style="font-size:20px;font-weight:bold;padding:8px 0 16px">${escapeHtml(heading)}</td></tr>
<tr><td style="font-size:14px;line-height:1.5">${bodyHtml}</td></tr>
<tr><td style="font-size:12px;color:#66728f;padding-top:20px;border-top:1px solid #e3e8f0">${escapeHtml(footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
}

export interface InvoiceEmailData {
  kind: 'invoice' | 'credit_note';
  number: string;
  customerName: string;
  bookingReference?: string;
  currency: string;
  total: number;
  sellerName: string;
  supportEmail?: string;
  /** Credit notes: the invoice they correct. */
  relatedInvoiceNumber?: string;
}

/** Booking confirmation (the invoice PDF is attached) or credit note e-mail. */
export function invoiceEmail(data: InvoiceEmailData): RenderedEmail {
  const credit = data.kind === 'credit_note';
  const name = singleLine(data.customerName, 80) || 'there';
  const brand = singleLine(data.sellerName, 80) || 'Karnish Tourism';
  const ref = data.bookingReference ? singleLine(data.bookingReference, 40) : '';
  const subject = credit
    ? `Credit note ${singleLine(data.number, 40)}${ref ? ` for booking ${ref}` : ''}`
    : `Your booking ${ref ? `${ref} ` : ''}is confirmed - invoice ${singleLine(data.number, 40)}`;
  const amount = money(data.total, data.currency);

  const lines = credit
    ? [
        `Hello ${name},`,
        `We have issued credit note ${data.number}${data.relatedInvoiceNumber ? ` against invoice ${data.relatedInvoiceNumber}` : ''}${ref ? ` for booking ${ref}` : ''}.`,
        `Amount refunded: ${amount}. The refund goes back to your original payment method.`,
        'The credit note is attached to this e-mail as a PDF.',
      ]
    : [
        `Hello ${name},`,
        `Thank you for booking with us. Your booking${ref ? ` ${ref}` : ''} is confirmed.`,
        `Your tax invoice ${data.number} for ${amount} is attached to this e-mail as a PDF.`,
        'Your voucher is available in your account under My bookings.',
      ];
  const footer = data.supportEmail ? `Questions? Reply to this e-mail or contact ${data.supportEmail}.` : 'Questions? Reply to this e-mail.';
  const text = `${lines.join('\n\n')}\n\n${footer}\n${brand}\n`;
  const html = layout(
    brand,
    credit ? 'Your credit note' : 'Your booking is confirmed',
    lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join(''),
    footer,
  );
  return { subject, html, text };
}

/** Low-stock / sold-out digest for operations (product names and dates only). */
export function stockAlertEmail(subject: string, lines: string[], brand = 'Karnish Tourism'): RenderedEmail {
  const safeLines = lines.slice(0, 200).map((line) => singleLine(line, 300));
  const text = `${safeLines.join('\n')}\n\nOpen the admin Inventory screens to review stock.\n`;
  const html = layout(
    brand,
    'Stock alert',
    `<ul style="margin:0;padding-left:18px">${safeLines.map((line) => `<li style="margin-bottom:6px">${escapeHtml(line)}</li>`).join('')}</ul>`,
    'Open the admin Inventory screens to review stock.',
  );
  return { subject: singleLine(subject, 150) || 'Stock alert', html, text };
}
