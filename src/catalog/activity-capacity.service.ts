import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from '../bookings/schemas/booking.schema';
import { CartSession } from '../checkout/schemas/cart-session.schema';

/**
 * Capacity already taken per service day for one activity option: quantities (adults + children)
 * in confirmed bookings, unexpired pending_payment bookings and unexpired open carts (holds).
 */
@Injectable()
export class ActivityCapacityService {
  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(CartSession.name) private readonly carts: Model<CartSession>,
  ) {}

  /**
   * `excludeCartId`: ignore one cart's own holds (it is the one being added to, modified or paid).
   * Days are inclusive YYYY-MM-DD bounds.
   */
  async usage(
    slug: string,
    optionId: string,
    fromDay: string,
    toDay: string,
    now: Date,
    excludeCartId?: string,
  ): Promise<Map<string, number>> {
    const [booked, held] = await Promise.all([
      this.bookings
        .aggregate<{ _id: string; qty: number }>([
          {
            $match: {
              activitySlug: slug,
              optionId,
              serviceDay: { $gte: fromDay, $lte: toDay },
              $or: [
                { status: 'confirmed' },
                { status: 'pending_payment', holdExpiresAt: { $gt: now } },
              ],
            },
          },
          { $group: { _id: '$serviceDay', qty: { $sum: { $add: ['$adults', '$children'] } } } },
        ])
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
        .exec(),
    ]);
    const usage = new Map<string, number>();
    for (const row of [...booked, ...held]) usage.set(row._id, (usage.get(row._id) ?? 0) + row.qty);
    return usage;
  }
}
