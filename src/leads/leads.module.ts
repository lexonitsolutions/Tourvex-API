import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StaffDirectoryModule } from '../admin/staff-directory/staff-directory.module';
import { AuthModule } from '../auth/auth.module';
import { CountersModule } from '../common/counters/counters';
import { Activity, ActivitySchema } from '../catalog/schemas/activity.schema';
import { ActivityEnquiryController } from './activity-enquiry.controller';
import { ContactController } from './contact.controller';
import { Lead, LeadSchema } from './lead.schema';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/** Unified leads CRM. Other modules import this and call `LeadsService.captureSafe(...)`. */
@Module({
  imports: [
    AuthModule,
    CountersModule,
    StaffDirectoryModule,
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  controllers: [LeadsController, ContactController, ActivityEnquiryController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
