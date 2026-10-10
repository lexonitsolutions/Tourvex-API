import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Counter, CounterSchema } from '../crm/billing/schemas/counter.schema';
import { StockModule } from '../stock/stock.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { Supplier, SupplierSchema } from './schemas/supplier.schema';

/** Suppliers and stock purchases; receiving / voiding goes through the Phase 1 stock engine. */
@Module({
  imports: [
    StockModule,
    MongooseModule.forFeature([
      { name: Supplier.name, schema: SupplierSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
