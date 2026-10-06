import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StaffDirectoryModule } from '../admin/staff-directory/staff-directory.module';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { CountersModule } from '../common/counters/counters';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AdminTicketsController } from './admin-tickets.controller';
import { Ticket, TicketSchema } from './ticket.schema';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    CountersModule,
    StaffDirectoryModule,
    NotificationsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      // Read-only: ownership check when a ticket is linked to a booking.
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [TicketsController, AdminTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
