import { Inject, Injectable, Logger } from '@nestjs/common';

export interface BookingConfirmationNotice {
  bookingReference: string;
  orderReference?: string;
}

export interface TicketNotice {
  ticketNumber: string;
  event: 'created' | 'staff_reply' | 'customer_reply' | 'resolved';
}

/** Operations alert about stock running low or out. Contains product names and dates only, never customer data. */
export interface StockAlertNotice {
  recipients: string[];
  subject: string;
  lines: string[];
}

/** Delivery channel (e-mail, WhatsApp, ...). Implement this and rebind NOTIFICATION_PROVIDER. */
export interface NotificationProvider {
  sendBookingConfirmation(notice: BookingConfirmationNotice): Promise<void>;
  sendTicketNotice?(notice: TicketNotice): Promise<void>;
  sendStockAlert?(notice: StockAlertNotice): Promise<void>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

/** Stub used until a real provider is configured: logs references only, never personal data. */
@Injectable()
export class LogNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger('Notifications');

  sendBookingConfirmation(notice: BookingConfirmationNotice): Promise<void> {
    this.logger.log(
      `Voucher e-mail not sent (no provider configured) for booking ${notice.bookingReference}`,
    );
    return Promise.resolve();
  }

  sendStockAlert(notice: StockAlertNotice): Promise<void> {
    this.logger.log(`Stock alert not sent (no provider configured): ${notice.lines.length} line(s) for ${notice.recipients.length} recipient(s)`);
    return Promise.resolve();
  }

  sendTicketNotice(notice: TicketNotice): Promise<void> {
    this.logger.log(`Ticket notice not sent (no provider configured): ${notice.ticketNumber} ${notice.event}`);
    return Promise.resolve();
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider) {}

  /** Support ticket events. Best effort and reference-only: never fails the request, never logs content. */
  async ticketEvent(notice: TicketNotice): Promise<void> {
    try {
      await this.provider.sendTicketNotice?.(notice);
    } catch {
      this.logger.warn(`Ticket notice failed for ${notice.ticketNumber}`);
    }
  }

  /** Stock alert e-mail to operations. Best effort: a failing provider must never fail a booking or the sweep. */
  async stockAlert(notice: StockAlertNotice): Promise<void> {
    try {
      await this.provider.sendStockAlert?.(notice);
    } catch {
      this.logger.warn('Stock alert notice failed');
    }
  }

  /** Best effort: a failing provider must never fail a payment confirmation. */
  async bookingConfirmed(notice: BookingConfirmationNotice): Promise<void> {
    try {
      await this.provider.sendBookingConfirmation(notice);
    } catch {
      this.logger.warn(`Confirmation notice failed for booking ${notice.bookingReference}`);
    }
  }
}
