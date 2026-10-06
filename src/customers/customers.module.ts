import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StaffDirectoryModule } from '../admin/staff-directory/staff-directory.module';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { LeadsModule } from '../leads/leads.module';
import { TicketsModule } from '../tickets/tickets.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { AdminCustomersController, AdminPartnersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { PartnersAdminService } from './partners-admin.service';

@Module({
  imports: [
    UsersModule,
    StaffDirectoryModule,
    TicketsModule,
    LeadsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // Read-only: lifetime value and recent bookings.
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [AdminCustomersController, AdminPartnersController],
  providers: [CustomersService, PartnersAdminService],
})
export class CustomersModule {}
