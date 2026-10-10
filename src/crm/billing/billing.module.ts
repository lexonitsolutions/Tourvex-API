import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../../notifications/notifications.module';
import { TaxModule } from '../../tax/tax.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

@Module({
  imports: [
    TaxModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
