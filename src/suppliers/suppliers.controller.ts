import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SearchSupplierDto } from './dto/search-supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Public()
  @Post('search')
  @ApiOperation({ summary: 'Search the mock supplier gateway for all supported service types' })
  search(@Body() dto: SearchSupplierDto) {
    return this.suppliers.search(dto);
  }
}
