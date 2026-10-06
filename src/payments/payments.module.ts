import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { OrdersModule } from '../checkout/orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [BookingsModule, OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
