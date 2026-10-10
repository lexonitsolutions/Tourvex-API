import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../bookings/bookings.module';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Activity, ActivitySchema } from '../catalog/schemas/activity.schema';
import { CapacityLock, CapacityLockSchema } from '../catalog/schemas/capacity-lock.schema';
import { CartSession, CartSessionSchema } from '../checkout/schemas/cart-session.schema';
import { BillingModule } from '../crm/billing/billing.module';
import { CruiseEnquiry, CruiseEnquirySchema } from '../cruises/schemas/cruise-enquiry.schema';
import { Cruise, CruiseSchema } from '../cruises/schemas/cruise.schema';
import { EventEnquiry, EventEnquirySchema } from '../events/schemas/event-enquiry.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { HolidayEnquiry, HolidayEnquirySchema } from '../holidays/schemas/holiday-enquiry.schema';
import { Holiday, HolidaySchema } from '../holidays/schemas/holiday.schema';
import { Lead, LeadSchema } from '../leads/lead.schema';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { EnquiryBookingService } from './enquiry-booking.service';
import { StockAlertState, StockAlertStateSchema } from './schemas/stock-alert-state.schema';
import { StockDay, StockDaySchema } from './schemas/stock-day.schema';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockPolicy, StockPolicySchema } from './schemas/stock-policy.schema';
import { StockAdminService } from './stock-admin.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/**
 * Stock and availability: the single derivation of capacity / sold / held / available (StockService), the admin API
 * (`/admin/stock`) and the enquiry-to-booking confirmation. Catalog, checkout and admin bookings import this module.
 */
@Module({
  imports: [
    BookingsModule,
    BillingModule,
    LeadsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: StockPolicy.name, schema: StockPolicySchema },
      { name: StockDay.name, schema: StockDaySchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: StockAlertState.name, schema: StockAlertStateSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: Holiday.name, schema: HolidaySchema },
      { name: Cruise.name, schema: CruiseSchema },
      { name: Event.name, schema: EventSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: CartSession.name, schema: CartSessionSchema },
      { name: CapacityLock.name, schema: CapacityLockSchema },
      { name: HolidayEnquiry.name, schema: HolidayEnquirySchema },
      { name: CruiseEnquiry.name, schema: CruiseEnquirySchema },
      { name: EventEnquiry.name, schema: EventEnquirySchema },
      { name: User.name, schema: UserSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  controllers: [StockController],
  providers: [StockService, StockAdminService, EnquiryBookingService],
  exports: [StockService, StockAdminService],
})
export class StockModule {}
