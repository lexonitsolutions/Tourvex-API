import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StockModule } from '../stock/stock.module';
import { OrdersService } from './orders.service';
import { CartSession, CartSessionSchema } from './schemas/cart-session.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { PromoCode, PromoCodeSchema } from './schemas/promo-code.schema';

/** Order/cart/promo persistence and the payment-success transition, shared by checkout and payments. */
@Module({
  imports: [
    BookingsModule,
    NotificationsModule,
    StockModule,
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: CartSession.name, schema: CartSessionSchema },
      { name: PromoCode.name, schema: PromoCodeSchema },
    ]),
  ],
  providers: [OrdersService],
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
