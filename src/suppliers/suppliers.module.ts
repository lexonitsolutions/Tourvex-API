import { Module } from '@nestjs/common';
import { MockSupplierAdapter } from './mock-supplier.adapter';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, MockSupplierAdapter],
  exports: [SuppliersService],
})
export class SuppliersModule {}
