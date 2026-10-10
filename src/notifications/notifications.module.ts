import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LogNotificationProvider,
  NOTIFICATION_PROVIDER,
  NotificationsService,
} from './notifications.service';
import { SmtpNotificationProvider, createSmtpTransport } from './smtp-notification.provider';

/** The SMTP provider when SMTP_HOST is set, otherwise the log-only provider (nothing is sent). */
export function notificationProviderFor(config: ConfigService) {
  const host = config.get<string>('SMTP_HOST');
  if (!host) return new LogNotificationProvider();
  const secure = String(config.get('SMTP_SECURE', 'false')).toLowerCase() === 'true';
  const from = config.get<string>('MAIL_FROM') || 'Karnish Tourism <no-reply@localhost>';
  return new SmtpNotificationProvider(
    createSmtpTransport({
      host,
      port: Number(config.get('SMTP_PORT', secure ? 465 : 587)),
      secure,
      user: config.get<string>('SMTP_USER') || undefined,
      pass: config.get<string>('SMTP_PASS') || undefined,
      from,
    }),
    from,
  );
}

@Module({
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_PROVIDER, inject: [ConfigService], useFactory: notificationProviderFor },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
