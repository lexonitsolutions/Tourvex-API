import { createTransport } from 'nodemailer';
import { escapeHtml, invoiceEmail, singleLine, stockAlertEmail } from './email-templates';
import { NotificationsService, LogNotificationProvider } from './notifications.service';
import { notificationProviderFor } from './notifications.module';
import { SmtpNotificationProvider } from './smtp-notification.provider';

// jsonTransport builds the message and returns it as JSON: no connection is ever opened.
const jsonProvider = () => new SmtpNotificationProvider(createTransport({ jsonTransport: true }), 'Karnish Tourism <no-reply@example.com>');

describe('e-mail templates', () => {
  it('escapes every dynamic value in the HTML and keeps subjects on one line', () => {
    const mail = invoiceEmail({
      kind: 'invoice',
      number: 'INV-2026-000001',
      customerName: '<script>alert(1)</script> & "Ada"',
      bookingReference: 'TVX-1\r\nBcc: evil@example.com',
      currency: 'AED',
      total: 1234.5,
      sellerName: '<b>Seller</b>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&amp;');
    expect(mail.html).not.toContain('<b>Seller</b>');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain('AED 1,234.50');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    expect(singleLine('a\r\nb')).toBe('a b');
  });

  it('writes credit notes and stock alerts with HTML and text bodies', () => {
    const credit = invoiceEmail({ kind: 'credit_note', number: 'CN-2026-000001', customerName: 'Ada', currency: 'AED', total: 50, sellerName: 'K', relatedInvoiceNumber: 'INV-2026-000001' });
    expect(credit.subject).toContain('Credit note CN-2026-000001');
    expect(credit.text).toContain('against invoice INV-2026-000001');
    const alert = stockAlertEmail('Stock alert', ['Burj <Khalifa> - Adult: sold out on 2026-11-01']);
    expect(alert.html).toContain('Burj &lt;Khalifa&gt;');
    expect(alert.text).toContain('Burj <Khalifa>');
  });
});

describe('SmtpNotificationProvider', () => {
  it('sends the invoice with the PDF attached', async () => {
    const info = await jsonProvider().sendInvoiceEmail({
      to: 'ada@example.com',
      kind: 'invoice',
      number: 'INV-2026-000001',
      customerName: 'Ada',
      bookingReference: 'TVX-1',
      currency: 'AED',
      total: 210,
      sellerName: 'Karnish Tourism',
      pdf: { filename: 'INV-2026-000001.pdf', content: Buffer.from('%PDF-1.3 test') },
    });
    expect(info.messageId).toBeTruthy();
  });

  it('builds the message: sender, recipient, subject, text, html and the attachment', async () => {
    const sent: Record<string, unknown>[] = [];
    const provider = new SmtpNotificationProvider(
      { sendMail: (options: Record<string, unknown>) => { sent.push(options); return Promise.resolve({ messageId: '<id@test>' }); } } as never,
      'Karnish Tourism <no-reply@example.com>',
    );
    const result = await provider.sendInvoiceEmail({
      to: 'ada@example.com', kind: 'invoice', number: 'INV-2026-000001', customerName: 'Ada', currency: 'AED', total: 210, sellerName: 'K',
      pdf: { filename: 'INV-2026-000001.pdf', content: Buffer.from('%PDF-1.3') },
    });
    expect(result.messageId).toBe('<id@test>');
    expect(sent[0]).toMatchObject({ from: 'Karnish Tourism <no-reply@example.com>', to: 'ada@example.com' });
    expect(String(sent[0].html)).toContain('INV-2026-000001');
    expect(sent[0].text).toBeTruthy();
    expect(sent[0].attachments).toEqual([{ filename: 'INV-2026-000001.pdf', content: Buffer.from('%PDF-1.3'), contentType: 'application/pdf' }]);
  });

  it('sends stock alerts to every recipient and skips when there are none', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
    const provider = new SmtpNotificationProvider({ sendMail }, 'a@b.c');
    await provider.sendStockAlert({ recipients: [], subject: 's', lines: ['l'] });
    expect(sendMail).not.toHaveBeenCalled();
    await provider.sendStockAlert({ recipients: ['ops@example.com', 'ops2@example.com'], subject: 'Low stock', lines: ['Item: 3 left'] });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ['ops@example.com', 'ops2@example.com'], subject: 'Low stock' }));
  });

  it('lets a failing transport reject so the caller can record the failure', async () => {
    const provider = new SmtpNotificationProvider({ sendMail: jest.fn().mockRejectedValue(new Error('connection refused')) }, 'a@b.c');
    await expect(provider.sendStockAlert({ recipients: ['x@example.com'], subject: 's', lines: ['l'] })).rejects.toThrow('connection refused');
  });
});

describe('provider selection and NotificationsService', () => {
  const config = (values: Record<string, unknown>) => ({ get: (key: string, fallback?: unknown) => values[key] ?? fallback }) as never;

  it('uses the log provider without SMTP_HOST and SMTP with it (a transport is only built, never connected)', () => {
    expect(notificationProviderFor(config({}))).toBeInstanceOf(LogNotificationProvider);
    expect(notificationProviderFor(config({ SMTP_HOST: '' }))).toBeInstanceOf(LogNotificationProvider);
    expect(notificationProviderFor(config({ SMTP_HOST: 'localhost', SMTP_PORT: 1025, MAIL_FROM: 'a@b.c' }))).toBeInstanceOf(SmtpNotificationProvider);
  });

  it('reports whether e-mail is enabled and never fails stock alerts', async () => {
    expect(new NotificationsService(new LogNotificationProvider()).emailEnabled).toBe(false);
    await expect(new NotificationsService(new LogNotificationProvider()).sendInvoiceEmail({} as never)).rejects.toThrow('not configured');
    const failing = new NotificationsService(new SmtpNotificationProvider({ sendMail: jest.fn().mockRejectedValue(new Error('down')) }, 'a@b.c'));
    expect(failing.emailEnabled).toBe(true);
    await expect(failing.stockAlert({ recipients: ['x@example.com'], subject: 's', lines: ['l'] })).resolves.toBeUndefined();
  });
});
