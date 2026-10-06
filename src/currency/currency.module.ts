import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { DEFAULT_FX_API_URL, FX_PROVIDER } from './currency.constants';
import { ExchangeRateApiProvider } from './fx-provider';
import { FxRate, FxRateSchema } from './schemas/fx-rate.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: FxRate.name, schema: FxRateSchema }])],
  controllers: [CurrencyController],
  providers: [
    CurrencyService,
    {
      provide: FX_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ExchangeRateApiProvider(
          config.get<string>('FX_API_URL', DEFAULT_FX_API_URL),
          config.get<string>('FX_API_KEY') || undefined,
        ),
    },
  ],
  exports: [CurrencyService],
})
export class CurrencyModule {}
