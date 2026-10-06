import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from '../bookings/schemas/booking.schema';
import { CartSession } from '../checkout/schemas/cart-session.schema';
import { CapacityLock } from './schemas/capacity-lock.schema';

export interface CapacityKey {
  slug: string;
  optionId: string;
  day: string;
}

const lockKey = ({ slug, optionId, day }: CapacityKey) => `${slug}|${optionId}|${day}`;

/**
 * Capacity already taken per service day for one activity option: quantities (adults + children)
 * in confirmed bookings, unexpired pending_payment bookings and unexpired open carts (holds).
 */
@Injectable()
export class ActivityCapacityService {
  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(CartSession.name) private readonly carts: Model<CartSession>,
    @InjectModel(CapacityLock.name) private readonly locks: Model<CapacityLock>,
  ) {}

  /** Makes sure the lock rows exist. Run it BEFORE the transaction: creating them inside would race on the unique key. */
  async ensureLocks(keys: CapacityKey[]): Promise<void> {
    for (const key of new Set(keys.map(lockKey))) {
      try {
        await this.locks.updateOne({ key }, { $setOnInsert: { key, version: 0 } }, { upsert: true }).exec();
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error; // a concurrent request created it first
      }
    }
  }

  /**
   * Takes the capacity locks inside a transaction. Sorted, so two transactions never wait on each other in a circle.
   * A concurrent transaction on the same day makes this one conflict and retry, and the retry sees its bookings.
   */
  async lock(keys: CapacityKey[], session: ClientSession): Promise<void> {
    for (const key of [...new Set(keys.map(lockKey))].sort()) {
      await this.locks.updateOne({ key }, { $inc: { version: 1 }, $set: { touchedAt: new Date() } }, { session }).exec();
    }
  }

  /**
   * `excludeCartId`: ignore one cart's own holds (it is the one being added to, modified or paid).
   * Days are inclusive YYYY-MM-DD bounds. `options.excludeOrderReference` ignores one order's own bookings;
   * `options.session` reads inside a transaction.
   */
  async usage(
    slug: string,
    optionId: string,
    fromDay: string,
    toDay: string,
    now: Date,
    excludeCartId?: string,
    options: { excludeOrderReference?: string; session?: ClientSession } = {},
  ): Promise<Map<string, number>> {
    const { excludeOrderReference, session } = options;
    const [booked, held] = await Promise.all([
      this.bookings
        .aggregate<{ _id: string; qty: number }>([
          {
            $match: {
              activitySlug: slug,
              optionId,
              serviceDay: { $gte: fromDay, $lte: toDay },
              ...(excludeOrderReference && { orderReference: { $ne: excludeOrderReference } }),
              $or: [
                { status: 'confirmed' },
                { status: 'pending_payment', holdExpiresAt: { $gt: now } },
              ],
            },
          },
          { $group: { _id: '$serviceDay', qty: { $sum: { $add: ['$adults', '$children'] } } } },
        ])
        .session(session ?? null)
        .exec(),
      this.carts
        .aggregate<{ _id: string; qty: number }>([
          {
            $match: {
              status: 'open',
              expiresAt: { $gt: now },
              ...(excludeCartId && { _id: { $ne: new Types.ObjectId(excludeCartId) } }),
              items: {
                $elemMatch: { activitySlug: slug, optionId, date: { $gte: fromDay, $lte: toDay } },
              },
            },
          },
          { $unwind: '$items' },
          {
            $match: {
              'items.activitySlug': slug,
              'items.optionId': optionId,
              'items.date': { $gte: fromDay, $lte: toDay },
            },
          },
          {
            $group: {
              _id: '$items.date',
              qty: { $sum: { $add: ['$items.adults', '$items.children'] } },
            },
          },
        ])
        .session(session ?? null)
        .exec(),
    ]);
    const usage = new Map<string, number>();
    for (const row of [...booked, ...held]) usage.set(row._id, (usage.get(row._id) ?? 0) + row.qty);
    return usage;
  }
}
