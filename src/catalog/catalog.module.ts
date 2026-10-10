import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrencyModule } from '../currency/currency.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { StockModule } from '../stock/stock.module';
import { ActivityCapacityService } from './activity-capacity.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Activity, ActivitySchema } from './schemas/activity.schema';

@Module({
  imports: [
    CurrencyModule,
    ReviewsModule,
    // Capacity, holds and locks are derived by the stock module (the single source of availability).
    StockModule,
    MongooseModule.forFeature([{ name: Activity.name, schema: ActivitySchema }]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService, ActivityCapacityService],
  exports: [CatalogService, ActivityCapacityService],
})
export class CatalogModule {}
