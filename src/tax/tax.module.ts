import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Invoice, InvoiceSchema } from '../crm/billing/schemas/invoice.schema';
import { Cruise, CruiseSchema } from '../cruises/schemas/cruise.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { Holiday, HolidaySchema } from '../holidays/schemas/holiday.schema';
import { SellerRegistration, SellerRegistrationSchema } from './schemas/seller-registration.schema';
import { TaxRegime, TaxRegimeSchema } from './schemas/tax-regime.schema';
import { TaxSetting, TaxSettingSchema } from './schemas/tax-setting.schema';
import { TaxAdminService } from './tax-admin.service';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

/** Tax regimes, seller registrations and the "which tax applies" rule (`/admin/tax`). Imported by billing, checkout, catalog and stock. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TaxRegime.name, schema: TaxRegimeSchema },
      { name: SellerRegistration.name, schema: SellerRegistrationSchema },
      { name: TaxSetting.name, schema: TaxSettingSchema },
      { name: Holiday.name, schema: HolidaySchema },
      { name: Cruise.name, schema: CruiseSchema },
      { name: Event.name, schema: EventSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [TaxController],
  providers: [TaxService, TaxAdminService],
  exports: [TaxService],
})
export class TaxModule {}
