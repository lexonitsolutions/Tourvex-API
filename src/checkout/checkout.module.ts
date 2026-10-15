import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CurrencyModule } from '../currency/currency.module';
import { PaymentsModule } from '../payments/payments.module';
import { TaxModule } from '../tax/tax.module';
import { EventsModule } from '../events/events.module';
import { VisasModule } from '../visas/visas.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { OrdersModule } from './orders.module';
import { PromosService } from './promos.service';
import { PackageCartService } from './package-cart.service';

@Module({
  imports: [OrdersModule, BookingsModule, CatalogModule, VisasModule, EventsModule, PaymentsModule, CurrencyModule, TaxModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, PromosService, PackageCartService],
})
export class CheckoutModule {}
