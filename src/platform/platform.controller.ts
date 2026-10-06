import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('platform')
@Controller('platform')
export class PlatformController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get('settings')
  settings() {
    const configured = this.config.get<string>('SUPPORTED_CURRENCIES', '*');
    const currencies =
      configured === '*'
        ? Intl.supportedValuesOf('currency')
        : configured.split(',').map((value) => value.trim().toUpperCase());
    return {
      locales: ['en', 'ar'],
      defaultLocale: 'en',
      direction: { en: 'ltr', ar: 'rtl' },
      currencies,
      defaultCurrency: this.config.get<string>('DEFAULT_CURRENCY', 'AED'),
      priceAuthority: 'server',
      policies: {
        cancellation:
          'Product-specific rules apply. The booking response always includes refundable, freeCancellationUntil and cancellationPolicy.',
        refunds:
          'Eligible card refunds are returned to the original payment method after finance approval and supplier confirmation.',
        partnerPricing:
          'Approved B2B accounts receive contract pricing; the local default is a 10% discount and is never calculated by the browser.',
      },
    };
  }
}
