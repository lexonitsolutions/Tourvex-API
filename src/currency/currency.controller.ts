import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrencyService } from './currency.service';

@ApiTags('currency')
@Controller('currency')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Public()
  @Get('rates')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary: 'Indicative AED-based exchange rates for the supported currencies',
    description: 'Never fails on missing data: answers { rates: { AED: 1 }, stale: true, updatedAt: null }.',
  })
  rates() {
    return this.currency.view();
  }
}
