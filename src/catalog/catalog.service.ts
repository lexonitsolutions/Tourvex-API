import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { appError } from '../common/app-error';
import {
  CURRENCY,
  fromMinor,
  moneyOf,
  priceCart,
  priceTravellers,
  type PriceLine,
} from '../checkout/checkout-pricing';
import { SettingsService } from '../admin/settings/settings.service';
import { CurrencyService } from '../currency/currency.service';
import { indicativeDisplay } from '../currency/display';
import { shouldExposeSamples } from '../holidays/holidays.utils';
import { ReviewsService } from '../reviews/reviews.service';
import {
  checkBookingRequest,
  computeDayStatus,
  daysOfMonth,
  freeCancellationUntil,
  isValidMonth,
  pickShortcuts,
  validateOptions,
  type DayStatus,
} from './activity-booking.utils';
import { ActivityCapacityService } from './activity-capacity.service';
import { AvailabilityQueryDto, QuoteDto } from './dto/activity-booking.dto';
import { ListActivitiesDto } from './dto/list-activities.dto';
import { UpdateActivityDetailsDto } from './dto/update-activity-details.dto';
import { Activity, ActivityOption } from './schemas/activity.schema';

/** Detail fields: hidden from lists, and stripped from sample activities in production. */
export const DETAIL_FIELDS = [
  'gallery',
  'operatingHours',
  'instantConfirmation',
  'mobileVoucher',
  'freeCancellationHours',
  'languages',
  'description',
  'highlights',
  'inclusions',
  'exclusions',
  'howToRedeem',
  'importantInfo',
  'location',
  'duration',
  'options',
  'detailsAreSample',
] as const;

const LIST_PROJECTION = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, 0]));

export interface PreparedItem {
  activity: {
    slug: string;
    title: string;
    image: string;
    locationName?: string;
  };
  option: ActivityOption;
  lines: PriceLine[];
  subtotalMinor: number;
  freeCancellationUntil?: Date;
}

export interface ItemInput {
  optionId: string;
  date: string;
  adults: number;
  children: number;
}

@Injectable()
export class CatalogService {
  private readonly sampleDetailsVisible: boolean;
  private readonly isProduction: boolean;

  constructor(
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    private readonly capacity: ActivityCapacityService,
    private readonly reviews: ReviewsService,
    private readonly currency: CurrencyService,
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.sampleDetailsVisible = shouldExposeSamples(nodeEnv, config.get<string>('ACTIVITY_SAMPLE_DETAILS'));
  }

  async listActivities(query: ListActivitiesDto) {
    const filter: Record<string, any> = { published: true };
    if (query.search) filter.$text = { $search: query.search };
    if (query.destination) filter.destinations = query.destination;
    if (query.category) filter.categories = query.category;

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.activities
        .find(filter, LIST_PROJECTION)
        .sort({ legacyId: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.activities.countDocuments(filter),
    ]);
    return {
      items: items.map((item) => this.localize(item, query.locale)),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
      currency: query.currency,
    };
  }

  async findBySlug(slug: string, locale = 'en') {
    const item = await this.loadVisible(slug);
    const rating = await this.reviews.summaryFor(slug);
    return { ...this.localize(item, locale), rating };
  }

  async upsertMany(items: Array<Record<string, unknown>>) {
    if (!items.length) return { imported: 0 };
    const operations: any[] = items.map((item) => ({
      updateOne: {
        filter: { slug: String(item.slug) },
        update: { $set: item },
        upsert: true,
      },
    }));
    const result = await this.activities.bulkWrite(operations);
    return {
      imported: items.length,
      created: result.upsertedCount,
      updated: result.modifiedCount,
    };
  }

  /** Staff edit of the detail block. Arrays (options, gallery, ...) are replaced wholesale. */
  async updateDetails(id: string, dto: UpdateActivityDetailsDto) {
    if (dto.options) {
      const problem = validateOptions(dto.options);
      if (problem) throw appError(400, 'INVALID_OPTIONS', problem);
    }
    const set: Record<string, unknown> = {};
    for (const field of DETAIL_FIELDS) {
      const value = (dto as unknown as Record<string, unknown>)[field];
      if (value !== undefined) set[field] = value;
    }
    // Staff-entered data is real; only the seed/import flags content as sample.
    set.detailsAreSample = dto.detailsAreSample ?? false;
    const updated = await this.activities
      .findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after', runValidators: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Activity not found');
    return this.localize(updated, 'en');
  }

  /** `GET /catalog/activities/:slug/availability`. */
  async availability(slug: string, query: AvailabilityQueryDto, now = new Date()) {
    if (!isValidMonth(query.month)) throw appError(400, 'INVALID_MONTH', 'month must be YYYY-MM');
    const { option } = await this.loadOption(slug, query.optionId);
    const dates = daysOfMonth(query.month);
    const usage = await this.capacity.usage(slug, option.id, dates[0], dates[dates.length - 1], now);
    const days = dates.map((date) => {
      const status: DayStatus = computeDayStatus({
        date,
        option,
        now,
        booked: usage.get(date) ?? 0,
      });
      return {
        date,
        status,
        ...(status === 'available' && {
          adultPrice: option.adultPrice,
          childPrice: option.childPrice ?? null,
        }),
      };
    });
    return {
      optionId: option.id,
      month: query.month,
      currency: CURRENCY,
      days,
      ...pickShortcuts(days, now),
    };
  }

  /** `POST /catalog/activities/:slug/quote`. Public, no hold is taken. */
  async quote(slug: string, dto: QuoteDto, displayCurrency?: string, now = new Date()) {
    const prepared = await this.prepareItem(slug, dto, now);
    const { taxPercent } = await this.settings.getCommerce();
    const pricing = priceCart(
      [{ slug, subtotalMinor: prepared.subtotalMinor }],
      null,
      taxPercent,
    );
    const display = indicativeDisplay(
      fromMinor(pricing.totalMinor),
      displayCurrency,
      this.currency.rates,
      this.currency.markupPercent,
    );
    return {
      lines: prepared.lines,
      subtotal: moneyOf(pricing.subtotalMinor),
      discount: moneyOf(0),
      taxesAndFees: moneyOf(pricing.taxMinor),
      total: moneyOf(pricing.totalMinor),
      currency: CURRENCY,
      refundable: prepared.option.refundable,
      ...(prepared.freeCancellationUntil && {
        freeCancellationUntil: prepared.freeCancellationUntil.toISOString(),
      }),
      ...(display && { display }),
    };
  }

  /**
   * Validates date window, availability, pax and child rules for one option and prices it
   * server-side. Shared by quote and the cart. Throws 400/404/409 with a stable `code`.
   * `excludeCartId`: the cart whose own holds must not count against the requested date.
   */
  async prepareItem(
    slug: string,
    input: ItemInput,
    now = new Date(),
    excludeCartId?: string,
  ): Promise<PreparedItem> {
    const { activity, option } = await this.loadOption(slug, input.optionId);
    const usage = await this.capacity.usage(
      slug,
      option.id,
      input.date,
      input.date,
      now,
      excludeCartId,
    );
    const failure = checkBookingRequest({
      option,
      date: input.date,
      adults: input.adults,
      children: input.children,
      now,
      booked: usage.get(input.date) ?? 0,
    });
    if (failure) throw appError(failure.status, failure.code, failure.message);

    const { lines, subtotalMinor } = priceTravellers({
      adultPrice: option.adultPrice,
      childPrice: option.childPrice,
      adults: input.adults,
      children: input.children,
    });
    return {
      activity: {
        slug: activity.slug,
        title: activity.title.en,
        image: activity.gallery?.[0]?.url ?? activity.imageUrl ?? '',
        ...(activity.location?.name && { locationName: activity.location.name }),
      },
      option,
      lines,
      subtotalMinor,
      freeCancellationUntil: freeCancellationUntil(input.date, option, activity.freeCancellationHours),
    };
  }

  /** Bookable activity + option, or 404. Sample details hidden in production make options unbookable. */
  async loadOption(slug: string, optionId: string) {
    const activity = await this.loadVisible(slug);
    const option = activity.options?.find((o) => o.id === optionId);
    if (!option) throw appError(404, 'OPTION_NOT_FOUND', 'Activity option not found');
    return { activity, option };
  }

  private async loadVisible(slug: string) {
    const item = await this.activities.findOne({ slug, published: true }).lean().exec();
    if (!item) throw new NotFoundException('Activity not found');
    if (item.detailsAreSample && !this.sampleDetailsVisible) {
      for (const field of DETAIL_FIELDS) delete (item as unknown as Record<string, unknown>)[field];
    }
    return item;
  }

  private localize(item: any, locale: string) {
    const { detailsAreSample, ...rest } = item;
    return {
      ...rest,
      // The sample flag is only exposed outside production.
      ...(detailsAreSample && !this.isProduction && { detailsAreSample: true }),
      title: item.title?.[locale] || item.title?.en,
      summary: item.summary?.[locale] || item.summary?.en,
      translations: undefined,
    };
  }
}
