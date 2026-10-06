import { Inject, Injectable, Logger } from '@nestjs/common';

export interface BookingConfirmationNotice {
  bookingReference: string;
  orderReference?: string;
}

export interface TicketNotice {
  ticketNumber: string;
  event: 'created' | 'staff_reply' | 'customer_reply' | 'resolved';
}

/** Delivery channel (e-mail, WhatsApp, ...). Implement this and rebind NOTIFICATION_PROVIDER. */
export interface NotificationProvider {
  sendBookingConfirmation(notice: BookingConfirmationNotice): Promise<void>;
  sendTicketNotice?(notice: TicketNotice): Promise<void>;
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

  /** Best effort: a failing provider must never fail a payment confirmation. */
  async bookingConfirmed(notice: BookingConfirmationNotice): Promise<void> {
    try {
      await this.provider.sendBookingConfirmation(notice);
    } catch {
      this.logger.warn(`Confirmation notice failed for booking ${notice.bookingReference}`);
    }
  }
}
