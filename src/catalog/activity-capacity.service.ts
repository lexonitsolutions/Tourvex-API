import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { StockService, type UsageOptions } from '../stock/stock.service';

export interface CapacityKey {
  slug: string;
  optionId: string;
  day: string;
}

const lockKeyOf = ({ slug, optionId, day }: CapacityKey) => ({
  productType: 'activity' as const,
  productRef: slug,
  variantId: optionId,
  day,
});

/**
 * Activity-shaped door to the stock engine, kept for the checkout and the catalog. The derivation itself (what is
 * sold, held and available) and the lock rows live in `StockService`, so activities and every other product type
 * share one implementation.
 */
@Injectable()
export class ActivityCapacityService {
  constructor(private readonly stock: StockService) {}

  /** Makes sure the lock rows exist. Run it BEFORE the transaction: creating them inside would race on the unique key. */
  ensureLocks(keys: CapacityKey[]): Promise<void> {
    return this.stock.ensureLocks(keys.map(lockKeyOf));
  }

  /** Takes the capacity locks inside a transaction (sorted, so two transactions never wait on each other in a circle). */
  lock(keys: CapacityKey[], session: ClientSession): Promise<void> {
    return this.stock.lock(keys.map(lockKeyOf), session);
  }

  /**
   * Units taken per service day (sold + held) for one activity option in [fromDay, toDay].
   * `excludeCartId`: ignore one cart's own holds. `options.excludeOrderReference` ignores one order's own bookings;
   * `options.session` reads inside a transaction.
   */
  async usage(
    slug: string,
    optionId: string,
    fromDay: string,
    toDay: string,
    now: Date,
    excludeCartId?: string,
    options: Pick<UsageOptions, 'excludeOrderReference' | 'session'> = {},
  ): Promise<Map<string, number>> {
    const usage = await this.stock.loadUsage([{ productType: 'activity', productRef: slug, variantId: optionId }], fromDay, toDay, now, {
      ...options,
      excludeCartId,
    });
    const result = new Map<string, number>();
    for (const perDay of usage.values()) {
      for (const [day, cell] of perDay) result.set(day, (result.get(day) ?? 0) + cell.sold + cell.held);
    }
    return result;
  }
}
