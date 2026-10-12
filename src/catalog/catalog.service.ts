import { CacheService } from '../common/cache/cache.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { appError, appErrorWith } from '../common/app-error';
import {
  CURRENCY,
  fromMinor,
  moneyOf,
  priceCart,
  priceTravellers,
  type PriceLine,
} from '../checkout/checkout-pricing';
import { CurrencyService } from '../currency/currency.service';
import { indicativeDisplay } from '../currency/display';
import { shouldExposeSamples, slugify } from '../holidays/holidays.utils';
import { ReviewsService } from '../reviews/reviews.service';
import { TaxService } from '../tax/tax.service';
import {
  checkBookingRequest,
  computeDayStatus,
  daysOfMonth,
  freeCancellationUntil,
  isValidIsoDate,
  isValidMonth,
  pickShortcuts,
  validateOptions,
  type DayStatus,
} from './activity-booking.utils';
import type { ClientSession } from 'mongoose';
import { StockService } from '../stock/stock.service';
import { AvailabilityQueryDto, QuoteDto } from './dto/activity-booking.dto';
import { ListActivitiesDto, ListAdminActivitiesDto } from './dto/list-activities.dto';
import { UpdateActivityDetailsDto } from './dto/update-activity-details.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Activity, ActivityOption } from './schemas/activity.schema';

/** Detail fields: hidden from lists, and stripped from sample activities in production. */
export const DETAIL_FIELDS = [
  'gallery',
  'heroVideo',
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
  'whatToBring',
  'cancellationPolicy',
  'itinerary',
  'faqs',
  'contentSections',
  'location',
  'duration',
  'options',
  'detailsAreSample',
] as const;

const LIST_PROJECTION = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, 0]));

const EDITABLE_CORE_FIELDS = ['slug', 'destinations', 'categories', 'price', 'salePrice', 'imageUrl', 'published'] as const;

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
  /** Cart item the request is about; echoed in the 409 body so the UI can mark the right line. */
  itemId?: string;
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
    private readonly stock: StockService,
    private readonly reviews: ReviewsService,
    private readonly currency: CurrencyService,
    private readonly cache: CacheService,
    private readonly tax: TaxService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.sampleDetailsVisible = shouldExposeSamples(nodeEnv, config.get<string>('ACTIVITY_SAMPLE_DETAILS'));
  }

  listActivities(query: ListActivitiesDto) {
    return this.cache.wrap('catalog', `list:${JSON.stringify(query)}`, 60, () => this.listActivitiesUncached(query));
  }

  private async listActivitiesUncached(query: ListActivitiesDto) {
    // Sold-out activities (no bookable date left) are hidden from the public list; admin lists are never filtered.
    const filter: Record<string, any> = { published: true, 'stockStatus.soldOut': { $ne: true } };
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
      items: items.map(({ stockStatus, ...item }) => ({
        ...this.localize(item, query.locale),
        stock: {
          lowStock: Boolean(stockStatus?.lowStock),
          remaining: stockStatus?.lowStock ? (stockStatus.lowestRemaining ?? null) : null,
        },
      })),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
      currency: query.currency,
    };
  }

  async listAdmin(query: ListAdminActivitiesDto) {
    const filter: Record<string, any> = {};
    if (query.q) filter.$text = { $search: query.q };
    if (query.published !== undefined) filter.published = query.published;
    if (query.sample !== undefined) filter.detailsAreSample = query.sample;
    const skip = (query.page - 1) * query.limit;
    const sort = query.sort === 'title_desc' ? { 'title.en': -1 } : query.sort === 'title_asc' ? { 'title.en': 1 } : { updatedAt: -1 };
    const [items, total] = await Promise.all([
      this.activities.find(filter, { title: 1, slug: 1, imageUrl: 1, gallery: 1, destinations: 1, categories: 1, published: 1, detailsAreSample: 1, updatedAt: 1 }).sort(sort as any).skip(skip).limit(query.limit).lean().exec(),
      this.activities.countDocuments(filter),
    ]);
    return {
      items: items.map((item) => ({
        id: String(item._id),
        title: item.title?.en || '',
        slug: item.slug,
        image: item.gallery?.[0]?.url || item.imageUrl,
        destinations: item.destinations || [],
        categories: item.categories || [],
        published: Boolean(item.published),
        isSample: Boolean(item.detailsAreSample),
        updatedAt: item.updatedAt,
      })),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
    };
  }

  async getAdmin(id: string) {
    const item = await this.activities.findById(id).lean().exec();
    if (!item) throw new NotFoundException('Activity not found');
    return { ...this.localize(item, 'en'), id: String(item._id), isSample: Boolean(item.detailsAreSample) };
  }

  async create(dto: CreateActivityDto) {
    const slug = dto.slug ?? slugify(dto.title);
    if (!slug) throw new BadRequestException('A URL slug could not be generated from the title');
    if (dto.options) {
      const problem = validateOptions(dto.options);
      if (problem) throw appError(400, 'INVALID_OPTIONS', problem);
    }
    const { title, summary, isSample, price, salePrice, ...input } = dto;
    try {
      const document: Record<string, unknown> = {
        ...input,
        slug,
        title: { en: title },
        ...(summary !== undefined && { summary: { en: summary } }),
        ...(price != null && { price }),
        ...(salePrice != null && { salePrice }),
        source: 'admin',
        published: dto.published ?? false,
        detailsAreSample: isSample ?? false,
      };
      const created = await this.activities.create(document as any);
      await this.cache.invalidate('catalog');
      return { ...this.localize(created.toObject(), 'en'), id: String(created._id), isSample: Boolean(created.detailsAreSample) };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) throw new ConflictException(`An activity with slug "${slug}" already exists`);
      throw error;
    }
  }

  async remove(id: string) {
    const deleted = await this.activities.findByIdAndDelete(id).lean().exec();
    if (!deleted) throw new NotFoundException('Activity not found');
    await this.cache.invalidate('catalog');
    return { deleted: true, id };
  }

  findBySlug(slug: string, locale = 'en') {
    return this.cache.wrap('catalog', `slug:${slug}:${locale}`, 60, () => this.findBySlugUncached(slug, locale));
  }

  private async findBySlugUncached(slug: string, locale = 'en') {
    const { stockStatus, ...item } = await this.loadVisible(slug);
    const rating = await this.reviews.summaryFor(slug);
    // A sold-out activity still opens (with its stock block saying so); only the list hides it.
    return { ...this.localize(item, locale), rating, stock: this.stock.publicStock(stockStatus) };
  }

  async upsertMany(items: Array<Record<string, unknown>>) {
    const result = await this.upsertManyUncached(items);
    await this.cache.invalidate('catalog');
    return result;
  }

  private async upsertManyUncached(items: Array<Record<string, unknown>>) {
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
    const result = await this.updateDetailsUncached(id, dto);
    await this.cache.invalidate('catalog');
    return result;
  }

  private async updateDetailsUncached(id: string, dto: UpdateActivityDetailsDto) {
    if (dto.options) {
      const problem = validateOptions(dto.options);
      if (problem) throw appError(400, 'INVALID_OPTIONS', problem);
    }
    const set: Record<string, unknown> = {};
    if (dto.title !== undefined) set.title = { en: dto.title };
    if (dto.summary !== undefined) set.summary = { en: dto.summary };
    for (const field of EDITABLE_CORE_FIELDS) {
      const value = (dto as unknown as Record<string, unknown>)[field];
      if (value !== undefined) set[field] = value;
    }
    for (const field of DETAIL_FIELDS) {
      const value = (dto as unknown as Record<string, unknown>)[field];
      if (value !== undefined) set[field] = value;
    }
    // Staff-entered data is real; only the seed/import flags content as sample.
    set.detailsAreSample = dto.isSample ?? dto.detailsAreSample ?? false;
    let updated;
    try {
      updated = await this.activities
        .findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after', runValidators: true })
        .lean()
        .exec();
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) throw new ConflictException(`An activity with slug "${dto.slug ?? ''}" already exists`);
      throw error;
    }
    if (!updated) throw new NotFoundException('Activity not found');
    return this.localize(updated, 'en');
  }

  /** `GET /catalog/activities/:slug/availability`. */
  async availability(slug: string, query: AvailabilityQueryDto, now = new Date()) {
    if (!isValidMonth(query.month)) throw appError(400, 'INVALID_MONTH', 'month must be YYYY-MM');
    const { option } = await this.loadOption(slug, query.optionId);
    const dates = daysOfMonth(query.month);
    const infos = await this.stock.capacityInfo(
      { productType: 'activity', productRef: slug, variantId: option.id },
      option.dailyCapacity ?? null,
      dates[0],
      dates[dates.length - 1],
      now,
    );
    const days = dates.map((date) => {
      const info = infos.get(date)!;
      const status: DayStatus = computeDayStatus({
        date,
        option,
        now,
        booked: info.booked,
        capacity: { limit: info.limit, closed: info.closed },
      });
      const remaining = info.limit === null ? null : Math.max(0, info.limit - info.booked);
      return {
        date,
        status,
        ...(status === 'available' && {
          adultPrice: option.adultPrice,
          childPrice: option.childPrice ?? null,
          // "Only 3 left" for the date picker.
          ...(remaining !== null && remaining <= info.threshold && { remaining }),
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
    const det = await this.tax.determineForProduct('activity', slug);
    const pricing = priceCart(
      [{ slug, subtotalMinor: prepared.subtotalMinor, taxPercent: det.percent, taxInclusive: det.pricesIncludeTax }],
      null,
      0,
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
    const info = await this.capacityOf(slug, option, input.date, now, { excludeCartId });
    const failure = checkBookingRequest({
      option,
      date: input.date,
      adults: input.adults,
      children: input.children,
      now,
      booked: info?.booked ?? 0,
      capacity: info && { limit: info.limit, closed: info.closed },
    });
    if (failure) throw this.failure(failure, input.itemId, info);

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

  /**
   * Re-checks capacity for items that are about to become bookings. Runs inside the order transaction after the
   * capacity locks are held, ignores the order's own bookings, and applies the same rules as `prepareItem`, so a
   * competing checkout that committed first makes this one fail with DATE_UNAVAILABLE instead of overselling.
   */
  async assertCapacity(
    items: { itemId?: string; activitySlug: string; optionId: string; date: string; adults: number; children: number }[],
    context: { orderReference: string; session: ClientSession; now?: Date },
  ): Promise<void> {
    const now = context.now ?? new Date();
    for (const item of items) {
      const { option } = await this.loadOption(item.activitySlug, item.optionId);
      const info = await this.capacityOf(item.activitySlug, option, item.date, now, {
        excludeOrderReference: context.orderReference,
        session: context.session,
      });
      const failure = checkBookingRequest({
        option,
        date: item.date,
        adults: item.adults,
        children: item.children,
        now,
        booked: info?.booked ?? 0,
        capacity: info && { limit: info.limit, closed: info.closed },
      });
      if (failure) throw this.failure(failure, item.itemId, info);
    }
  }

  /** 409 body of an unavailable date: `itemId` (the failing cart line) and `available` (units left, when known). */
  private failure(
    failure: { status: number; code: string; message: string },
    itemId: string | undefined,
    info?: { limit: number | null; closed: boolean; booked: number },
  ) {
    if (failure.code !== 'DATE_UNAVAILABLE') return appError(failure.status, failure.code, failure.message);
    const available = !info ? undefined : info.closed ? 0 : info.limit === null ? undefined : Math.max(0, info.limit - info.booked);
    return appErrorWith(failure.status, failure.code, failure.message, {
      ...(itemId && { itemId }),
      ...(available !== undefined && { available }),
    });
  }

  /** Is a cart line still bookable as requested, and how many places are left (when capacity is limited). Never throws. */
  async lineAvailability(slug: string, input: ItemInput, now: Date, excludeCartId?: string): Promise<{ available: boolean; remaining?: number }> {
    try {
      const { option } = await this.loadOption(slug, input.optionId);
      const info = await this.capacityOf(slug, option, input.date, now, { excludeCartId });
      const failure = checkBookingRequest({
        option,
        date: input.date,
        adults: input.adults,
        children: input.children,
        now,
        booked: info?.booked ?? 0,
        capacity: info && { limit: info.limit, closed: info.closed },
      });
      const remaining = !info ? undefined : info.closed ? 0 : info.limit === null ? undefined : Math.max(0, info.limit - info.booked);
      return { available: !failure, ...(remaining !== undefined && { remaining }) };
    } catch {
      return { available: false };
    }
  }

  /** Effective capacity of one option on one day (date override > policy default > legacy dailyCapacity > unlimited). */
  private async capacityOf(
    slug: string,
    option: ActivityOption,
    date: string,
    now: Date,
    options: { excludeCartId?: string; excludeOrderReference?: string; session?: ClientSession },
  ) {
    // An invalid date is rejected by checkBookingRequest with INVALID_DATE; there is nothing to count for it.
    if (!isValidIsoDate(date)) return undefined;
    const infos = await this.stock.capacityInfo(
      { productType: 'activity', productRef: slug, variantId: option.id },
      option.dailyCapacity ?? null,
      date,
      date,
      now,
      options,
    );
    return infos.get(date);
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
