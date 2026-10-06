import { BASE_CURRENCY } from './currency.constants';
import {
  convertAmount,
  isConversionActive,
  normalizeCurrency,
  type Money,
  type RateMap,
} from './currency.conversion';

/**
 * Indicative equivalent of an AED amount in the visitor's currency for routes the interceptor never
 * converts (quote, checkout). Undefined for AED, unsupported codes or when no FX rate is cached.
 */
export function indicativeDisplay(
  amountAed: number,
  requested: unknown,
  rates: RateMap,
  markupPercent: number,
): { currency: string; total: Money } | undefined {
  const target = normalizeCurrency(requested);
  if (!target || target === BASE_CURRENCY || !isConversionActive(target, rates)) return undefined;
  const converted = convertAmount(amountAed, BASE_CURRENCY, target, rates, markupPercent);
  if (converted === null) return undefined;
  return { currency: target, total: { amount: converted, currency: target } };
}
