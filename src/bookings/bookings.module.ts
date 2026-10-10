import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingModule } from '../crm/billing/billing.module';
import { InventoryModule } from '../crm/inventory/inventory.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { StockPolicy, StockPolicySchema } from '../stock/schemas/stock-policy.schema';
import { BookingCostService } from './booking-cost';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './schemas/booking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: StockPolicy.name, schema: StockPolicySchema },
    ]),
    InventoryModule,
    BillingModule,
    VouchersModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingCostService],
  exports: [BookingsService],
})
export class BookingsModule {}
