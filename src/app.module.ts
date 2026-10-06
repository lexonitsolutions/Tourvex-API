import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminBookingsModule } from './admin-bookings/admin-bookings.module';
import { AdminModule } from './admin/admin.module';
import { AdminReportsModule } from './admin-reports/admin-reports.module';
import { PermissionsGuard } from './admin/permissions.guard';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { BookingsModule } from './bookings/bookings.module';
import { CmsModule } from './cms/cms.module';
import { CatalogModule } from './catalog/catalog.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ClerkModule } from './clerk/clerk.module';
import { CruisesModule } from './cruises/cruises.module';
import { EventsModule } from './events/events.module';
import { CurrencyInterceptor } from './currency/currency.interceptor';
import { CurrencyModule } from './currency/currency.module';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnvironment } from './config/env.validation';
import { BillingModule } from './crm/billing/billing.module';
import { InventoryModule } from './crm/inventory/inventory.module';
import { HealthModule } from './health/health.module';
import { HolidaysModule } from './holidays/holidays.module';
import { MediaModule } from './media/media.module';
import { PartnersModule } from './partners/partners.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { UsersModule } from './users/users.module';
import { VisasModule } from './visas/visas.module';
import { FinanceModule } from './finance/finance.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { CustomersModule } from './customers/customers.module';
import { LeadsModule } from './leads/leads.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5_000,
        retryWrites: true,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ClerkModule,
    AuthModule,
    UsersModule,
    AuditModule,
    AdminModule,
    AdminReportsModule,
    CatalogModule,
    HolidaysModule,
    VisasModule,
    CruisesModule,
    EventsModule,
    PartnersModule,
    CurrencyModule,
    SuppliersModule,
    InventoryModule,
    BillingModule,
    BookingsModule,
    AdminBookingsModule,
    VouchersModule,
    FinanceModule,
    LeadsModule,
    TicketsModule,
    CustomersModule,
    PaymentsModule,
    NotificationsModule,
    ReviewsModule,
    CheckoutModule,
    PlatformModule,
    HealthModule,
    MediaModule,
    CmsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: CurrencyInterceptor },
  ],
})
export class AppModule {}
