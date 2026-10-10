import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import { StockPolicy } from '../stock/schemas/stock-policy.schema';
import { bookingStockKey, type BookingStockFacts } from '../stock/stock.service';
import { itemKeyString } from '../stock/stock.types';
import { Booking } from './schemas/booking.schema';

export interface BookingCost {
  unitCost: number;
  quantity: number;
  total: number;
  currency: string;
  source: 'policy';
  at: Date;
}

/** Money is computed in integer minor units (2 decimals). */
const toMinor = (amount: number) => Math.round((amount + Number.EPSILON) * 100);

/** Policy unit cost x units, or null when the item has no unit cost (a missing cost is not a cost of zero). */
export function buildCostSnapshot(
  unitCost: number | null | undefined,
  quantity: number,
  currency: string,
  at: Date,
): BookingCost | null {
  if (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0) return null;
  return {
    unitCost: toMinor(unitCost) / 100,
    quantity,
    total: (toMinor(unitCost) * quantity) / 100,
    currency,
    source: 'policy',
    at,
  };
}

type CostableBooking = BookingStockFacts & { _id: Types.ObjectId; currency: string; cost?: unknown };

/**
 * Stores the supplier cost snapshot on bookings that were just confirmed (online payment and staff enquiry
 * confirmation). Written once: a booking that already carries a `cost` (even `null`) is left alone, so a repeated
 * webhook never changes history and later price edits never rewrite past margins.
 */
@Injectable()
export class BookingCostService {
  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(StockPolicy.name) private readonly policies: Model<StockPolicy>,
  ) {}

  /** Pass the transaction `session` when called inside one. Mutates the given booking objects with the snapshot. */
  async snapshot(bookings: CostableBooking[], session?: ClientSession, at = new Date()): Promise<void> {
    const pending = bookings.filter((booking) => booking.cost === undefined);
    if (!pending.length) return;
    const keys = new Map<string, NonNullable<ReturnType<typeof bookingStockKey>>>();
    for (const booking of pending) {
      const key = bookingStockKey(booking);
      if (key) keys.set(itemKeyString(key), key);
    }
    const costs = new Map<string, number | null>();
    if (keys.size) {
      const rows = await this.policies
        .find({ $or: [...keys.values()].map(({ productType, productRef, variantId }) => ({ productType, productRef, variantId })) })
        .select('productType productRef variantId unitCost')
        .session(session ?? null)
        .lean()
        .exec();
      for (const row of rows) costs.set(itemKeyString(row), row.unitCost ?? null);
    }
    for (const booking of pending) {
      const key = bookingStockKey(booking);
      const cost = buildCostSnapshot(key ? costs.get(itemKeyString(key)) : null, booking.quantity, booking.currency, at);
      const result = await this.bookings
        .updateOne({ _id: booking._id, cost: { $exists: false } }, { $set: { cost } }, { session })
        .exec();
      if (result.modifiedCount) booking.cost = cost;
    }
  }
}
