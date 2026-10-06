import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventBanner, EventBannerSchema } from './schemas/event-banner.schema';
import { EventEnquiry, EventEnquirySchema } from './schemas/event-enquiry.schema';
import { Event, EventSchema } from './schemas/event.schema';

@Module({
  imports: [
    AuthModule,
    LeadsModule,
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventBanner.name, schema: EventBannerSchema },
      { name: EventEnquiry.name, schema: EventEnquirySchema },
    ]),
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
