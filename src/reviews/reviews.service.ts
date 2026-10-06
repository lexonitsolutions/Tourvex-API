import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking } from '../bookings/schemas/booking.schema';
import { Activity } from '../catalog/schemas/activity.schema';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { appError } from '../common/app-error';
import { UsersService } from '../users/users.service';
import {
  CreateReviewDto,
  ListReviewsAdminDto,
  ListReviewsDto,
  ModerateReviewDto,
} from './dto/reviews.dto';
import { computeRatingSummary, displayName, reviewEligibility, type RatingSummary } from './reviews.utils';
import { Review } from './schemas/review.schema';

const ELIGIBILITY_MESSAGES = {
  wrong_activity: 'That booking is not for this activity',
  not_confirmed: 'Only confirmed bookings can be reviewed',
  service_not_passed: 'You can review an activity after the service date has passed',
  already_reviewed: 'You have already reviewed this booking',
} as const;

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    private readonly users: UsersService,
  ) {}

  /** Computed from published reviews only; null when there are none. */
  async summaryFor(slug: string): Promise<RatingSummary | null> {
    const rows = await this.reviews
      .aggregate<{ _id: number; n: number }>([
        { $match: { activitySlug: slug, status: 'published' } },
        { $group: { _id: '$rating', n: { $sum: 1 } } },
      ])
      .exec();
    return computeRatingSummary(Object.fromEntries(rows.map((r) => [r._id, r.n])));
  }

  async list(slug: string, query: ListReviewsDto) {
    await this.assertActivity(slug);
    const filter: Record<string, unknown> = { activitySlug: slug, status: 'published' };
    if (query.rating) filter.rating = query.rating;
    if (query.withImages) filter['images.0'] = { $exists: true };
    const sort: Record<string, 1 | -1> =
      query.sort === 'top' ? { rating: -1, createdAt: -1 } : { createdAt: -1 };
    const skip = (query.page - 1) * query.limit;
    const [docs, total, summary] = await Promise.all([
      this.reviews.find(filter).sort(sort).skip(skip).limit(query.limit).lean().exec(),
      this.reviews.countDocuments(filter),
      this.summaryFor(slug),
    ]);
    return {
      summary,
      items: docs.map((doc) => ({
        id: doc._id.toString(),
        displayName: doc.displayName,
        rating: doc.rating,
        title: doc.title,
        body: doc.body,
        createdAt: doc.createdAt,
        ...(doc.images?.length && { images: doc.images }),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(slug: string, dto: CreateReviewDto, user: AuthenticatedUser) {
    await this.assertActivity(slug);
    const booking = await this.bookings
      .findOne({ reference: dto.bookingReference, customerId: new Types.ObjectId(user.sub) })
      .lean()
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    const alreadyReviewed = !!(await this.reviews.exists({ bookingId: booking._id }));
    const verdict = reviewEligibility({ booking, activitySlug: slug, alreadyReviewed, now: new Date() });
    if (verdict !== 'ok') {
      throw appError(
        verdict === 'already_reviewed' ? 409 : 403,
        `REVIEW_${verdict.toUpperCase()}`,
        ELIGIBILITY_MESSAGES[verdict],
      );
    }
    const profile = await this.users.getProfile(user.sub);
    try {
      const created = await this.reviews.create({
        activitySlug: slug,
        bookingId: booking._id,
        bookingReference: booking.reference,
        userId: new Types.ObjectId(user.sub),
        displayName: displayName(profile.firstName, profile.lastName),
        rating: dto.rating,
        title: dto.title,
        body: dto.body,
        status: 'pending',
      });
      return {
        id: created._id.toString(),
        status: created.status,
        message: 'Thank you. Your review will appear after moderation.',
      };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw appError(409, 'REVIEW_ALREADY_REVIEWED', ELIGIBILITY_MESSAGES.already_reviewed);
      }
      throw error;
    }
  }

  async moderate(id: string, dto: ModerateReviewDto, moderatorId: string) {
    const review = await this.reviews
      .findByIdAndUpdate(
        id,
        { $set: { status: dto.status, moderatedAt: new Date(), moderatedBy: new Types.ObjectId(moderatorId) } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  /** Staff queue. Includes bookingReference but never contact details. */
  async listForStaff(query: ListReviewsAdminDto) {
    const filter = { status: query.status };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.reviews.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean().exec(),
      this.reviews.countDocuments(filter),
    ]);
    return {
      items,
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
    };
  }

  private async assertActivity(slug: string) {
    if (!(await this.activities.exists({ slug, published: true }))) {
      throw new NotFoundException('Activity not found');
    }
  }
}
