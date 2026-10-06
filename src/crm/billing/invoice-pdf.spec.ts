import { renderInvoicePdf } from './invoice-pdf';

describe('renderInvoicePdf', () => {
  const model = {
    kind: 'invoice' as const,
    number: 'INV-2026-000001',
    issuedAt: new Date('2026-10-05T08:00:00Z'),
    status: 'paid',
    currency: 'AED',
    seller: { legalName: 'Karnish Tourism LLC', address: 'Dubai, UAE', taxNumber: '100123456700003', email: 'help@example.com', phone: '+971 4 000 0000' },
    customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
    bookingReference: 'TVX-2026-1A2B3C4D',
    lines: [{ label: 'Desert safari (sharing)', qty: 2, unitAmount: 100, total: 200 }],
    subtotal: 200,
    discount: 0,
    tax: 10,
    taxPercent: 5,
    total: 210,
  };

  it('produces a PDF document', async () => {
    const pdf = await renderInvoicePdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it('renders credit notes and survives non-Latin text', async () => {
    const pdf = await renderInvoicePdf({
      ...model,
      kind: 'credit_note',
      number: 'CN-2026-000001',
      customer: { name: 'محمد', email: 'm@example.com' },
      relatedInvoiceNumber: 'INV-2026-000001',
      reason: 'Cancelled',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
