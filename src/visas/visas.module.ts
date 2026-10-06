import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { VisaBanner, VisaBannerSchema } from './schemas/visa-banner.schema';
import { VisaEnquiry, VisaEnquirySchema } from './schemas/visa-enquiry.schema';
import { VisaSection, VisaSectionSchema } from './schemas/visa-section.schema';
import { Visa, VisaSchema } from './schemas/visa.schema';
import { VisasController } from './visas.controller';
import { VisasService } from './visas.service';

@Module({
  imports: [
    AuthModule,
    LeadsModule,
    MongooseModule.forFeature([
      { name: Visa.name, schema: VisaSchema },
      { name: VisaSection.name, schema: VisaSectionSchema },
      { name: VisaBanner.name, schema: VisaBannerSchema },
      { name: VisaEnquiry.name, schema: VisaEnquirySchema },
    ]),
  ],
  controllers: [VisasController],
  providers: [VisasService],
  exports: [VisasService],
})
export class VisasModule {}
