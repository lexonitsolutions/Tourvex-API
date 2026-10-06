import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { map, Observable } from 'rxjs';
import { convertResponseBody, isConvertibleRoute, normalizeCurrency } from './currency.conversion';
import { CurrencyService } from './currency.service';

/**
 * Global interceptor: owns all currency conversion. Modules keep returning AED; for eligible GET
 * routes with a supported `?currency=` the Money objects in the body are converted on the way out.
 */
@Injectable()
export class CurrencyInterceptor implements NestInterceptor {
  private readonly prefix: string;

  constructor(
    private readonly currency: CurrencyService,
    config: ConfigService,
  ) {
    this.prefix = config.get<string>('API_PREFIX', 'api/v1');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (!isConvertibleRoute(request.method, request.path, this.prefix)) return next.handle();

    const target = normalizeCurrency(request.query?.currency);
    return next.handle().pipe(
      map((body) => {
        const { body: converted, active } = convertResponseBody(
          body,
          target,
          this.currency.rates,
          this.currency.markupPercent,
        );
        if (active && target !== 'AED') {
          const response = http.getResponse<Response>();
          response.setHeader('X-Currency', target as string);
          const updatedAt = this.currency.updatedAt;
          if (updatedAt) response.setHeader('X-FX-Updated', updatedAt.toISOString());
        }
        return converted;
      }),
    );
  }
}
