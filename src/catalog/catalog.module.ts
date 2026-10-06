import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { CartSession, CartSessionSchema } from '../checkout/schemas/cart-session.schema';
import { CurrencyModule } from '../currency/currency.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ActivityCapacityService } from './activity-capacity.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { CapacityLock, CapacityLockSchema } from './schemas/capacity-lock.schema';

@Module({
  imports: [
    CurrencyModule,
    ReviewsModule,
    MongooseModule.forFeature([
      { name: Activity.name, schema: ActivitySchema },
      // Read-only here: used to count capacity taken by bookings and cart holds.
      { name: Booking.name, schema: BookingSchema },
      { name: CartSession.name, schema: CartSessionSchema },
      { name: CapacityLock.name, schema: CapacityLockSchema },
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService, ActivityCapacityService],
  exports: [CatalogService, ActivityCapacityService],
})
export class CatalogModule {}
