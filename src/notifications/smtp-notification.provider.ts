import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { invoiceEmail, singleLine, stockAlertEmail } from './email-templates';
import type {
  BookingConfirmationNotice,
  InvoiceEmailNotice,
  NotificationProvider,
  StockAlertNotice,
  TicketNotice,
} from './notifications.service';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Builds the SMTP transport. The credentials only go to nodemailer; nothing here logs them. */
export function createSmtpTransport(settings: SmtpSettings): Transporter {
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user && { auth: { user: settings.user, pass: settings.pass ?? '' } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * Real e-mail delivery through SMTP (nodemailer). Selected by the notifications module when SMTP_HOST is set.
 * The transport is injected so tests use nodemailer's `jsonTransport` / `streamTransport` and never open a connection.
 * Logs references only (never addresses, names or credentials).
 */
@Injectable()
export class SmtpNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}

  sendBookingConfirmation(notice: BookingConfirmationNotice): Promise<void> {
    // The customer's confirmation (with the invoice PDF) is sent from the billing flow once the invoice exists.
    this.logger.log(`Booking ${notice.bookingReference} confirmed; the invoice e-mail follows from billing`);
    return Promise.resolve();
  }

  sendTicketNotice(notice: TicketNotice): Promise<void> {
    this.logger.log(`Ticket notice not e-mailed (no template yet): ${notice.ticketNumber} ${notice.event}`);
    return Promise.resolve();
  }

  async sendStockAlert(notice: StockAlertNotice): Promise<void> {
    if (!notice.recipients.length) return;
    const mail = stockAlertEmail(notice.subject, notice.lines);
    await this.transport.sendMail({
      from: this.from,
      to: notice.recipients,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    this.logger.log(`Stock alert e-mailed: ${notice.lines.length} line(s) to ${notice.recipients.length} recipient(s)`);
  }

  async sendInvoiceEmail(notice: InvoiceEmailNotice): Promise<{ messageId?: string }> {
    const mail = invoiceEmail({
      kind: notice.kind,
      number: notice.number,
      customerName: notice.customerName,
      bookingReference: notice.bookingReference,
      currency: notice.currency,
      total: notice.total,
      sellerName: notice.sellerName,
      supportEmail: notice.supportEmail,
      relatedInvoiceNumber: notice.relatedInvoiceNumber,
    });
    const info = (await this.transport.sendMail({
      from: this.from,
      to: singleLine(notice.to, 200),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [{ filename: notice.pdf.filename, content: notice.pdf.content, contentType: 'application/pdf' }],
    })) as { messageId?: string };
    this.logger.log(`${notice.kind === 'invoice' ? 'Invoice' : 'Credit note'} ${notice.number} e-mailed`);
    return { messageId: info.messageId };
  }
}
