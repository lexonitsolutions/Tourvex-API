import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../bookings/bookings.module';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Refund, RefundSchema } from '../bookings/schemas/refund.schema';
import { CatalogModule } from '../catalog/catalog.module';
import { Order, OrderSchema } from '../checkout/schemas/order.schema';
import { BillingModule } from '../crm/billing/billing.module';
import { InventoryModule } from '../crm/inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { StockModule } from '../stock/stock.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { VouchersModule } from '../vouchers/vouchers.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';

/** Staff-facing bookings, orders, refunds and cancellation requests (`/admin/bookings`). */
@Module({
  imports: [
    BookingsModule,
    VouchersModule,
    BillingModule,
    PaymentsModule,
    CatalogModule,
    InventoryModule,
    NotificationsModule,
    StockModule,
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AdminBookingsController],
  providers: [AdminBookingsService],
})
export class AdminBookingsModule {}
