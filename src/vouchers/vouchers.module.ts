import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminVouchersController, PublicVouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { Voucher, VoucherSchema } from './voucher.schema';

/** Imports the Booking schema directly (not BookingsModule) so BookingsModule can depend on this one. */
@Module({
  imports: [
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Voucher.name, schema: VoucherSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [AdminVouchersController, PublicVouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
