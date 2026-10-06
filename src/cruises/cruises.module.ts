import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { CruisesController } from './cruises.controller';
import { CruisesService } from './cruises.service';
import { CruiseBanner, CruiseBannerSchema } from './schemas/cruise-banner.schema';
import { CruiseEnquiry, CruiseEnquirySchema } from './schemas/cruise-enquiry.schema';
import { Cruise, CruiseSchema } from './schemas/cruise.schema';

@Module({
  imports: [
    AuthModule,
    LeadsModule,
    MongooseModule.forFeature([
      { name: Cruise.name, schema: CruiseSchema },
      { name: CruiseBanner.name, schema: CruiseBannerSchema },
      { name: CruiseEnquiry.name, schema: CruiseEnquirySchema },
    ]),
  ],
  controllers: [CruisesController],
  providers: [CruisesService],
  exports: [CruisesService],
})
export class CruisesModule {}
