import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { HolidayBanner, HolidayBannerSchema } from './schemas/holiday-banner.schema';
import { HolidayCollection, HolidayCollectionSchema } from './schemas/holiday-collection.schema';
import { HolidayEnquiry, HolidayEnquirySchema } from './schemas/holiday-enquiry.schema';
import { Holiday, HolidaySchema } from './schemas/holiday.schema';

@Module({
  imports: [
    AuthModule,
    LeadsModule,
    MongooseModule.forFeature([
      { name: Holiday.name, schema: HolidaySchema },
      { name: HolidayCollection.name, schema: HolidayCollectionSchema },
      { name: HolidayBanner.name, schema: HolidayBannerSchema },
      { name: HolidayEnquiry.name, schema: HolidayEnquirySchema },
    ]),
  ],
  controllers: [HolidaysController],
  providers: [HolidaysService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
