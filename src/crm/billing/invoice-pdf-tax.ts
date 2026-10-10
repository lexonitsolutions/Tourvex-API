// pdfkit is a CommonJS `export =` module and this project compiles without esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import * as QRCode from 'qrcode';
import { allocate } from '../../checkout/checkout-pricing';
import { zatcaTlvBase64 } from '../../tax/zatca';
import { amountInWords } from './amount-words';
import type { InvoicePdfModel } from './invoice-pdf';
import { LINE, MUTED, NAVY, dateText, money, safe } from './pdf-helpers';

export type InvoiceLayout = 'uae' | 'india' | 'generic';

/** UAE style, India GST style (SAC, CGST/SGST or IGST columns) or the generic VAT/GST layout. */
export function layoutOf(tax: { country: string; model: string }): InvoiceLayout {
  if (tax.model === 'india_gst') return 'india';
  return tax.country.toUpperCase() === 'AE' ? 'uae' : 'generic';
}

const toMinor = (value: number) => Math.round(value * 100 + Math.sign(value) * 1e-7);
const fromMinor = (minor: number) => minor / 100;

interface Column {
  key: string;
  title: string;
  x: number;
  width: number;
  align: 'left' | 'right';
}

/**
 * Tax invoice / credit note with the regime's layout. Money in the model is in major units; the per-line split of the
 * taxable value and of each tax component is done in integer minor units with the largest-remainder rule, so the
 * columns always add up to the totals.
 */
export async function renderTaxInvoicePdf(model: InvoicePdfModel, options: { compress?: boolean } = {}): Promise<Buffer> {
  const tax = model.taxInfo!;
  const layout = layoutOf(tax);
  const credit = model.kind === 'credit_note';
  const sign = credit ? -1 : 1;
  const regLabel = tax.registrationLabel || (layout === 'india' ? 'GSTIN' : layout === 'uae' ? 'TRN' : 'VAT No');
  const title = model.title || (credit ? 'Credit Note' : 'Tax Invoice');
  const buyer = model.buyer ?? { name: model.customer.name, email: model.customer.email };
  const sellerReg = model.seller.registrationNumber || model.seller.taxNumber;

  let qrImage: Buffer | undefined;
  if (tax.qr === 'zatca' && !credit) {
    const taxTotal = tax.components.reduce((sum, c) => sum + c.taxAmount, 0);
    const payload = zatcaTlvBase64({
      sellerName: model.seller.legalName,
      vatNumber: sellerReg,
      timestamp: model.issuedAt,
      total: model.total,
      vat: taxTotal,
    });
    qrImage = await QRCode.toBuffer(payload, { margin: 1, width: 120, errorCorrectionLevel: 'M' });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      compress: options.compress ?? true,
      info: { Title: `${title} ${model.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const cur = model.currency;

    // ---- Seller (left) and document title (right)
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(safe(model.seller.legalName) || 'Company', left, 40, { width: 300 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (model.seller.address) doc.text(safe(model.seller.address), left, doc.y + 2, { width: 280 });
    if (sellerReg) doc.text(`${regLabel}: ${safe(sellerReg)}`);
    if (layout === 'india' && (model.seller.state || model.seller.stateCode)) {
      doc.text(`State: ${safe(model.seller.state)}${model.seller.stateCode ? ` (State code ${safe(model.seller.stateCode)})` : ''}`);
    }
    const contact = [model.seller.email, model.seller.phone].filter(Boolean).join('  |  ');
    if (contact) doc.text(safe(contact));
    const leftBottom = doc.y;

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(safe(title).toUpperCase(), left, 40, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(`Number: ${model.number}`, left, doc.y + 4, { width, align: 'right' });
    doc.text(`Date: ${dateText(model.issuedAt)}`, { width, align: 'right' });
    if (model.relatedInvoiceNumber) doc.text(`Against invoice: ${model.relatedInvoiceNumber}`, { width, align: 'right' });
    if (tax.reverseCharge) doc.text('Reverse charge applies', { width, align: 'right' });

    let y = Math.max(doc.y, leftBottom, 120) + 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 12;

    // ---- Bill to (left) and references (right)
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('BILL TO', left, y);
    doc.fillColor(NAVY).fontSize(11).text(safe(buyer.name) || 'Customer', left, y + 12, { width: 280 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    if (buyer.address) doc.text(safe(buyer.address), { width: 280 });
    if (buyer.email) doc.text(safe(buyer.email));
    if (buyer.registrationNumber) doc.text(`${regLabel}: ${safe(buyer.registrationNumber)}`);
    const buyerState = [buyer.state, buyer.stateCode ? `(${buyer.stateCode})` : ''].filter(Boolean).join(' ');
    if (layout === 'india' && buyerState) doc.text(`State: ${safe(buyerState)}`);
    const buyerBottom = doc.y;

    const refs: string[] = [];
    if (model.bookingReference) refs.push(`Booking: ${model.bookingReference}`);
    if (model.orderReference) refs.push(`Order: ${model.orderReference}`);
    if (model.paymentReference) refs.push(`Payment ref: ${model.paymentReference}`);
    const pos = tax.placeOfSupply;
    if (layout === 'india' && pos && (pos.state || pos.stateCode)) {
      refs.push(`Place of supply: ${[pos.state, pos.stateCode ? `(${pos.stateCode})` : ''].filter(Boolean).join(' ')}`);
    } else if (pos?.country && layout !== 'uae') {
      refs.push(`Place of supply: ${pos.country}`);
    }
    doc.fillColor(MUTED).fontSize(9).text(refs.map(safe).join('\n'), left + width / 2, y + 12, { width: width / 2, align: 'right' });
    y = Math.max(doc.y, buyerBottom, y + 56) + 14;

    // ---- Lines table
    const lineMinor = model.lines.map((line) => toMinor(line.total));
    const taxable = tax.components[0]?.taxableAmount ?? model.subtotal - model.discount;
    const taxableMinor = toMinor(taxable);
    const netByLine = allocate(taxableMinor, lineMinor);
    const compMinor = tax.components.map((c) => allocate(toMinor(c.taxAmount), netByLine));
    const taxByLine = model.lines.map((_, i) => compMinor.reduce((sum, c) => sum + c[i], 0));

    const columns = buildColumns(layout, tax, left, width);
    doc.rect(left, y, width, 22).fill('#f3f5f9');
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
    for (const col of columns) doc.text(col.title, col.x + 3, y + 7, { width: col.width - 6, align: col.align });
    y += 28;

    doc.font('Helvetica').fontSize(9);
    model.lines.forEach((line, i) => {
      const labelCol = columns[0];
      const height = Math.max(doc.heightOfString(safe(line.label), { width: labelCol.width - 6 }), 13);
      if (y + height > doc.page.height - 260) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const net = netByLine[i];
      const unit = net === lineMinor[i] ? line.unitAmount : fromMinor(Math.round(net / Math.max(1, line.qty)));
      const cells: Record<string, string> = {
        desc: safe(line.label),
        sac: tax.serviceCode?.value ?? '',
        qty: String(line.qty),
        unit: money(unit, cur),
        amount: money(sign * fromMinor(net), cur),
        rate: `${tax.percent}%`,
        tax: money(sign * fromMinor(taxByLine[i]), cur),
      };
      tax.components.forEach((c, ci) => {
        cells[`pct${ci}`] = `${c.percent}%`;
        cells[`amt${ci}`] = money(sign * fromMinor(compMinor[ci][i]), cur);
      });
      doc.fillColor(NAVY);
      for (const col of columns) doc.text(cells[col.key] ?? '', col.x + 3, y, { width: col.width - 6, align: col.align });
      y += height + 8;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor(LINE).stroke();
    });

    // ---- Totals
    if (y > doc.page.height - 250) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 10;
    const labelX = left + width * 0.5;
    const valueX = left + width * 0.5 + 130;
    const valueW = right - valueX - 3;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? NAVY : MUTED);
      doc.text(label, labelX, y, { width: 130 });
      doc.text(value, valueX, y, { width: valueW, align: 'right' });
      y += bold ? 20 : 15;
    };
    if (!tax.pricesIncludeTax) {
      row('Subtotal', money(sign * model.subtotal, cur));
      if (model.discount > 0) row('Discount', money(-sign * model.discount, cur));
    }
    row(`Total excluding ${tax.taxName}`, money(sign * taxable, cur));
    for (const c of tax.components) row(`${safe(c.label)} ${c.percent}%`, money(sign * c.taxAmount, cur));
    if (!tax.components.length) row(`${safe(tax.taxName)} ${tax.percent}%`, money(sign * model.tax, cur));
    doc.moveTo(labelX, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 6;
    row(credit ? `Total refunded (${cur})` : `Total (${cur})`, money(sign * model.total, cur), true);
    if (tax.pricesIncludeTax) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Prices include ${safe(tax.taxName)}.`, labelX, y, { width: right - labelX, align: 'right' });
      y += 12;
    }

    // ---- Amount in words (India), reason, bank details, notes
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (layout === 'india') {
      doc.text(`Amount in words: ${amountInWords(toMinor(model.total), cur)}`, left, y + 4, { width });
      y = doc.y + 6;
    }
    if (model.reason) {
      doc.text(`Reason: ${safe(model.reason)}`, left, y, { width });
      y = doc.y + 6;
    }
    if (model.seller.bankDetails) {
      doc.font('Helvetica-Bold').text('Bank details', left, y, { width });
      doc.font('Helvetica').text(safe(model.seller.bankDetails), { width: width * 0.6 });
      y = doc.y + 6;
    }
    if (qrImage) {
      doc.image(qrImage, left, Math.min(y + 4, doc.page.height - 190), { width: 90 });
      doc.fontSize(7).fillColor(MUTED).text('ZATCA e-invoice QR', left, Math.min(y + 96, doc.page.height - 98), { width: 90, align: 'center' });
    }

    const footer: string[] = [];
    if (tax.notes) footer.push(tax.notes);
    if (layout === 'india' && !/computer generated/i.test(tax.notes ?? '')) {
      footer.push('This is a computer generated invoice and does not require a signature.');
    }
    footer.push(
      credit
        ? 'This credit note confirms a refund to the original payment method.'
        : `Amounts are in ${cur}. Thank you for booking with us.`,
    );
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(safe(footer.join(' ')), left, doc.page.height - 66, { width, align: 'center' });
    doc.end();
  });
}

function buildColumns(layout: InvoiceLayout, tax: { components: { code: string; label: string }[]; taxName: string }, left: number, width: number): Column[] {
  const col = (key: string, title: string, share: number, align: 'left' | 'right', offset: number): Column => ({
    key,
    title,
    x: left + width * offset,
    width: width * share,
    align,
  });
  if (layout === 'india') {
    const split = tax.components.length > 1;
    if (split) {
      return [
        col('desc', 'DESCRIPTION', 0.22, 'left', 0),
        col('sac', 'SAC', 0.08, 'left', 0.22),
        col('qty', 'QTY', 0.05, 'right', 0.3),
        col('amount', 'TAXABLE VALUE', 0.16, 'right', 0.35),
        col('pct0', 'CGST %', 0.08, 'right', 0.51),
        col('amt0', 'CGST AMT', 0.14, 'right', 0.59),
        col('pct1', 'SGST %', 0.08, 'right', 0.73),
        col('amt1', 'SGST AMT', 0.14, 'right', 0.81),
      ];
    }
    return [
      col('desc', 'DESCRIPTION', 0.33, 'left', 0),
      col('sac', 'SAC', 0.1, 'left', 0.33),
      col('qty', 'QTY', 0.06, 'right', 0.43),
      col('amount', 'TAXABLE VALUE', 0.18, 'right', 0.49),
      col('pct0', 'IGST %', 0.08, 'right', 0.67),
      col('amt0', 'IGST AMT', 0.25, 'right', 0.75),
    ];
  }
  const name = tax.taxName.toUpperCase();
  return [
    col('desc', 'DESCRIPTION', 0.34, 'left', 0),
    col('qty', 'QTY', 0.07, 'right', 0.34),
    col('unit', layout === 'uae' ? 'UNIT PRICE (EX VAT)' : `UNIT PRICE (EX ${name})`, 0.17, 'right', 0.41),
    col('amount', layout === 'uae' ? 'AMOUNT (EX VAT)' : `AMOUNT (EX ${name})`, 0.17, 'right', 0.58),
    col('rate', `${name} %`, 0.08, 'right', 0.75),
    col('tax', `${name} AMOUNT`, 0.17, 'right', 0.83),
  ];
}
