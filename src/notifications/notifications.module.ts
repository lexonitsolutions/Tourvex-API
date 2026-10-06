import { Module } from '@nestjs/common';
import {
  LogNotificationProvider,
  NOTIFICATION_PROVIDER,
  NotificationsService,
} from './notifications.service';

@Module({
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_PROVIDER, useClass: LogNotificationProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
