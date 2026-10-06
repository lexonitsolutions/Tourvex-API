import { Injectable } from '@nestjs/common';
import { SearchSupplierDto } from './dto/search-supplier.dto';
import { MockSupplierAdapter } from './mock-supplier.adapter';

@Injectable()
export class SuppliersService {
  constructor(private readonly adapter: MockSupplierAdapter) {}

  search(dto: SearchSupplierDto) {
    return this.adapter.search(dto);
  }

  reserve(offerId: string, travelers: number) {
    return this.adapter.reserve(offerId, travelers);
  }

  confirm(reference: string) {
    return this.adapter.confirm(reference);
  }

  cancel(reference: string) {
    return this.adapter.cancel(reference);
  }
}
