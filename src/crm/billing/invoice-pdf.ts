// pdfkit is a CommonJS `export =` module and this project compiles without esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { LINE, MUTED, NAVY, dateText, money, safe } from './pdf-helpers';
import { renderTaxInvoicePdf } from './invoice-pdf-tax';

export interface InvoicePdfSeller {
  legalName: string;
  address: string;
  taxNumber: string;
  email: string;
  phone: string;
  registrationLabel?: string;
  registrationNumber?: string;
  country?: string;
  state?: string;
  stateCode?: string;
  website?: string;
  bankDetails?: string;
}

export interface InvoicePdfBuyer {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  country?: string;
  state?: string;
  stateCode?: string;
  registrationNumber?: string;
}

export interface InvoicePdfTax {
  country: string;
  taxName: string;
  model: string;
  rateCode: string;
  percent: number;
  components: { code: string; label: string; percent: number; taxableAmount: number; taxAmount: number }[];
  placeOfSupply?: { country: string; state?: string; stateCode?: string };
  serviceCode?: { label: string; value: string; description?: string };
  pricesIncludeTax: boolean;
  reverseCharge?: boolean;
  qr?: string;
  registrationLabel?: string;
  notes?: string;
}

export interface InvoicePdfModel {
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: Date;
  status: string;
  currency: string;
  seller: InvoicePdfSeller;
  customer: { name: string; email: string };
  /** Tax module documents: title, tax snapshot and buyer. Without `taxInfo` the legacy layout is used. */
  title?: string;
  taxInfo?: InvoicePdfTax;
  buyer?: InvoicePdfBuyer;
  bookingReference?: string;
  orderReference?: string;
  relatedInvoiceNumber?: string;
  paymentReference?: string;
  reason?: string;
  lines: { label: string; qty: number; unitAmount: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  taxPercent?: number | null;
  total: number;
}

/** Renders an invoice or credit note to a PDF buffer. No external services; pure pdfkit. */
export function renderInvoicePdf(model: InvoicePdfModel, options: { compress?: boolean } = {}): Promise<Buffer> {
  if (model.taxInfo) return renderTaxInvoicePdf(model, options);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      compress: options.compress ?? true,
      info: { Title: `${model.kind === 'invoice' ? 'Invoice' : 'Credit note'} ${model.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const sign = model.kind === 'credit_note' ? -1 : 1;

    // Seller block.
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(safe(model.seller.legalName) || 'Company', left, 48);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (model.seller.address) doc.text(safe(model.seller.address), left, doc.y + 2, { width: 280 });
    if (model.seller.taxNumber) doc.text(`TRN / VAT no: ${safe(model.seller.taxNumber)}`);
    const contact = [model.seller.email, model.seller.phone].filter(Boolean).join('  |  ');
    if (contact) doc.text(safe(contact));

    // Title block (right).
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(model.kind === 'invoice' ? 'TAX INVOICE' : 'CREDIT NOTE', left, 48, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(`Number: ${model.number}`, left, doc.y + 4, { width, align: 'right' });
    doc.text(`Date: ${dateText(model.issuedAt)}`, { width, align: 'right' });
    if (model.relatedInvoiceNumber) doc.text(`Against invoice: ${model.relatedInvoiceNumber}`, { width, align: 'right' });

    let y = Math.max(doc.y, 130) + 18;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 14;

    // Bill to + references.
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('BILL TO', left, y);
    doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(safe(model.customer.name) || 'Customer', left, y + 12);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(safe(model.customer.email));
    const refs: string[] = [];
    if (model.bookingReference) refs.push(`Booking: ${model.bookingReference}`);
    if (model.orderReference) refs.push(`Order: ${model.orderReference}`);
    if (model.paymentReference) refs.push(`Payment ref: ${model.paymentReference}`);
    doc.fillColor(MUTED).fontSize(9).text(refs.map(safe).join('\n'), left + width / 2, y + 12, { width: width / 2, align: 'right' });
    y = Math.max(doc.y, y + 60) + 16;

    // Lines table.
    const cols = { label: left, qty: left + width * 0.55, unit: left + width * 0.66, total: left + width * 0.83 };
    doc.rect(left, y, width, 22).fill('#f3f5f9');
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', cols.label + 8, y + 7);
    doc.text('QTY', cols.qty, y + 7, { width: 40, align: 'right' });
    doc.text('UNIT', cols.unit, y + 7, { width: 70, align: 'right' });
    doc.text('AMOUNT', cols.total, y + 7, { width: right - cols.total - 8, align: 'right' });
    y += 28;
    doc.font('Helvetica').fontSize(10).fillColor(NAVY);
    for (const line of model.lines) {
      const height = Math.max(
        doc.heightOfString(safe(line.label), { width: cols.qty - cols.label - 16 }),
        14,
      );
      if (y + height > doc.page.height - 200) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.fillColor(NAVY).text(safe(line.label), cols.label + 8, y, { width: cols.qty - cols.label - 16 });
      doc.text(String(line.qty), cols.qty, y, { width: 40, align: 'right' });
      doc.text(money(line.unitAmount, model.currency), cols.unit, y, { width: 70, align: 'right' });
      doc.text(money(sign * line.total, model.currency), cols.total, y, { width: right - cols.total - 8, align: 'right' });
      y += height + 8;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor(LINE).stroke();
    }

    // Totals.
    y += 10;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? NAVY : MUTED);
      doc.text(label, cols.unit - 90, y, { width: 150, align: 'left' });
      doc.text(value, cols.total, y, { width: right - cols.total - 8, align: 'right' });
      y += bold ? 20 : 16;
    };
    row('Subtotal', money(sign * model.subtotal, model.currency));
    if (model.discount > 0) row('Discount', money(-sign * model.discount, model.currency));
    row(
      model.taxPercent ? `Taxes & fees (${model.taxPercent}%)` : 'Taxes & fees',
      money(sign * model.tax, model.currency),
    );
    doc.moveTo(cols.unit - 90, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 6;
    row(model.kind === 'invoice' ? 'Total paid' : 'Total refunded', money(sign * model.total, model.currency), true);

    if (model.reason) {
      y += 8;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Reason: ${safe(model.reason)}`, left, y, { width });
    }

    // Footer.
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      model.kind === 'invoice'
        ? 'Amounts are in the currency shown and include taxes and fees. Thank you for booking with us.'
        : 'This credit note confirms a refund to the original payment method.',
      left,
      doc.page.height - 70,
      { width, align: 'center' },
    );
    doc.end();
  });
}
