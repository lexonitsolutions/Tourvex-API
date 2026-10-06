import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Refund, RefundSchema } from '../bookings/schemas/refund.schema';
import { Order, OrderSchema } from '../checkout/schemas/order.schema';
import { BillingModule } from '../crm/billing/billing.module';
import { AdminInvoicesController, FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/** Finance overview, daily reconciliation and the invoice admin (`/admin/finance`, `/admin/invoices`). */
@Module({
  imports: [
    BillingModule,
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [FinanceController, AdminInvoicesController],
  providers: [FinanceService],
})
export class FinanceModule {}
