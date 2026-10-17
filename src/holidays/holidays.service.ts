import { CacheService } from '../common/cache/cache.service';
import { adminCatalogFilter, toAdminRecord } from '../common/catalog/admin-catalog';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from '../leads/leads.service';
import { publicStock } from '../stock/stock.rules';
import { fromHolidayEnquiry } from '../leads/leads.rules';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { ListHolidaysDto } from './dto/list-holidays.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import {
  buildHolidayFilter,
  buildHolidaySort,
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
} from './holidays.utils';
import { HolidayBanner } from './schemas/holiday-banner.schema';
import { HolidayCollection } from './schemas/holiday-collection.schema';
import { HolidayEnquiry } from './schemas/holiday-enquiry.schema';
import { Holiday } from './schemas/holiday.schema';
import { CreateHolidayEnquiryDto } from './dto/create-enquiry.dto';
import { ListHolidayEnquiriesDto, UpdateHolidayEnquiryStatusDto } from './dto/update-enquiry-status.dto';

const CURRENCY = 'AED';
const COLLECTION_ITEM_LIMIT = 12;
const HOME_COLLECTION_LIMIT = 12;
const HOME_BANNER_LIMIT = 10;
const HOME_CITY_LIMIT = 24;
const HOME_COUNTRY_LIMIT = 24;
const FACET_LIMIT = 50;
const RELATED_LIMIT = 6;
const REFERENCE_ATTEMPTS = 5;

/** Fields needed to render a PackageCard (cover image only, not the whole gallery). */
const CARD_FIELDS = {
  slug: 1,
  title: 1,
  destinations: 1,
  country: 1,
  durationNights: 1,
  durationDays: 1,
  price: 1,
  salePrice: 1,
  rating: 1,
  themes: 1,
  collections: 1,
  published: 1,
  allowAddToCart: 1,
  isSample: 1,
  updatedAt: 1,
};
const CARD_FIND_PROJECTION = { ...CARD_FIELDS, images: { $slice: 1 } };
const CARD_AGG_PROJECTION = { ...CARD_FIELDS, images: { $slice: ['$images', 1] } };

type Lean = Record<string, any>;

@Injectable()
export class HolidaysService {
  private readonly showSamples: boolean;
  private readonly isProduction: boolean;

  constructor(
    @InjectModel(Holiday.name) private readonly holidays: Model<Holiday>,
    @InjectModel(HolidayCollection.name) private readonly collections: Model<HolidayCollection>,
    @InjectModel(HolidayBanner.name) private readonly banners: Model<HolidayBanner>,
    @InjectModel(HolidayEnquiry.name) private readonly enquiries: Model<HolidayEnquiry>,
    private readonly leads: LeadsService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.showSamples = shouldExposeSamples(nodeEnv, config.get<string>('HOLIDAYS_ALLOW_SAMPLES'));
  }

  private get visible() {
    return publicVisibilityFilter(this.showSamples);
  }

  /** Visible AND still bookable somewhere: what public lists show. Detail pages and enquiries use `visible`, so a sold-out product still opens. */
  private get listable() {
    return { ...this.visible, 'stockStatus.soldOut': { $ne: true } };
  }

  home() {
    return this.cache.wrap('holidays', 'home', 60, () => this.homeUncached());
  }

  private async homeUncached() {
    const [banners, cities, countries, collections] = await Promise.all([
      this.banners
        .find({ published: true })
        .sort({ order: 1, _id: 1 })
        .limit(HOME_BANNER_LIMIT)
        .lean()
        .exec(),
      this.cities(),
      this.countriesSummary(),
      this.homeCollections(),
    ]);
    return {
      banners: banners.map((b) => ({
        id: String(b._id),
        ...(b.eyebrow ? { eyebrow: b.eyebrow } : {}),
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        image: b.image,
        video: (b as any).video || '',
        ctaLabel: b.ctaLabel,
        ctaHref: b.ctaHref,
      })),
      cities,
      countries,
      collections,
      currency: CURRENCY,
    };
  }

  list(query: ListHolidaysDto, admin = false) {
    if (admin) return this.listUncached(query, admin);
    return this.cache.wrap('holidays', `list:${JSON.stringify(query)}`, 60, () => this.listUncached(query, admin));
  }

  private async listUncached(query: ListHolidaysDto, admin = false) {
    const base = admin ? adminCatalogFilter(query) : this.listable;
    const filter = buildHolidayFilter(query, base);
    const { addFields, sort } = buildHolidaySort(query.sort);
    const skip = (query.page - 1) * query.limit;

    const pipeline: PipelineStage[] = [{ $match: filter }];
    if (addFields) pipeline.push({ $addFields: addFields as any });
    pipeline.push(
      { $sort: sort },
      { $skip: skip },
      { $limit: query.limit },
      { $project: CARD_AGG_PROJECTION },
    );

    const [docs, total, facets] = await Promise.all([
      this.holidays.aggregate<Lean>(pipeline).exec(),
      this.holidays.countDocuments(filter).exec(),
      this.facets(base),
    ]);
    return {
      items: docs.map((doc) => (admin ? { ...this.toCard(doc), ...this.adminFlags(doc) } : this.toCard(doc))),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
      facets,
      currency: query.currency,
    };
  }

  findBySlug(slug: string, currency = CURRENCY) {
    return this.cache.wrap('holidays', `slug:${slug}:${currency}`, 60, () => this.findBySlugUncached(slug, currency));
  }

  private async findBySlugUncached(slug: string, currency = CURRENCY) {
    const doc = await this.holidays
      .findOne({ slug, ...this.visible })
      .lean<Lean>()
      .exec();
    if (!doc) throw new NotFoundException('Holiday package not found');

    const related = await this.holidays
      .find(
        {
          _id: { $ne: doc._id },
          ...this.listable,
          $or: [{ destinations: { $in: doc.destinations } }, { themes: { $in: doc.themes } }],
        },
        CARD_FIND_PROJECTION,
      )
      .sort({ popularity: -1, _id: 1 })
      .limit(RELATED_LIMIT)
      .lean<Lean[]>()
      .exec();

    return {
      package: { ...this.toPackage(doc, !this.isProduction), stock: publicStock(doc.stockStatus) },
      related: related.map((r) => this.toCard(r)),
      currency,
    };
  }

  async create(dto: CreateHolidayDto) {
    const result = await this.createUncached(dto);
    await this.cache.invalidate('holidays');
    return result;
  }

  private async createUncached(dto: CreateHolidayDto) {
    const slug = dto.slug ?? slugify(dto.title);
    if (!slug) throw new BadRequestException('Could not derive a slug from the title; provide one');
    try {
      const created = await this.holidays.create({
        ...dto,
        allowAddToCart: false,
        slug,
        durationDays: dto.durationDays ?? dto.durationNights + 1,
      });
      return this.toPackage(created.toObject(), true, true);
    } catch (error) {
      throw this.mapWriteError(error, slug);
    }
  }

  async update(id: string, dto: UpdateHolidayDto) {
    const result = await this.updateUncached(id, dto);
    await this.cache.invalidate('holidays');
    return result;
  }

  private async updateUncached(id: string, dto: UpdateHolidayDto) {
    const changes: Record<string, unknown> = { ...dto, allowAddToCart: false };
    if (dto.durationNights !== undefined && dto.durationDays === undefined) {
      changes.durationDays = dto.durationNights + 1;
    }
    try {
      const updated = await this.holidays
        .findByIdAndUpdate(id, { $set: changes }, { returnDocument: 'after', runValidators: true })
        .lean<Lean>()
        .exec();
      if (!updated) throw new NotFoundException('Holiday package not found');
      return this.toPackage(updated, true, true);
    } catch (error) {
      throw this.mapWriteError(error, dto.slug);
    }
  }

  async remove(id: string) {
    const result = await this.removeUncached(id);
    await this.cache.invalidate('holidays');
    return result;
  }

  private async removeUncached(id: string) {
    const deleted = await this.holidays.findByIdAndDelete(id).select({ _id: 1 }).lean().exec();
    if (!deleted) throw new NotFoundException('Holiday package not found');
    return { id, deleted: true };
  }

  /** Raw stored record for the admin editor, including unpublished and sample records. */
  async getAdmin(id: string) {
    const doc = await this.holidays.findById(id).lean<Lean>().exec();
    if (!doc) throw new NotFoundException('Holiday package not found');
    return toAdminRecord(doc);
  }

  private adminFlags(doc: Lean) {
    return {
      published: Boolean(doc.published),
      isSample: Boolean(doc.isSample),
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    };
  }

  private mapWriteError(error: unknown, slug?: string) {
    if ((error as { code?: number })?.code === 11000) {
      return new ConflictException(`A holiday package with slug "${slug ?? ''}" already exists`);
    }
    return error;
  }

  private async facets(base: Record<string, unknown>) {
    const group = (field: string) => [
      { $unwind: `$${field}` },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: FACET_LIMIT },
      { $project: { _id: 0, name: '$_id', count: 1 } },
    ];
    const [result] = await this.holidays
      .aggregate<{ destinations: unknown[]; countries: unknown[]; themes: unknown[] }>([
        { $match: base },
        {
          $facet: {
            destinations: group('destinations') as any,
            countries: [
              { $group: { _id: '$country', count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: FACET_LIMIT },
              { $project: { _id: 0, name: '$_id', count: 1 } },
            ],
            themes: group('themes') as any,
          },
        },
      ])
      .exec();
    return result ?? { destinations: [], countries: [], themes: [] };
  }

  private async cities() {
    const rows = await this.holidays
      .aggregate<Lean>([
        { $match: this.listable },
        { $sort: { popularity: -1, _id: 1 } },
        { $unwind: '$destinations' },
        {
          $group: {
            _id: '$destinations',
            count: { $sum: 1 },
            country: { $first: '$country' },
            image: { $first: { $arrayElemAt: ['$images.url', 0] } },
            minPrice: { $min: { $ifNull: ['$salePrice.amount', '$price.amount'] } },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: HOME_CITY_LIMIT },
      ])
      .exec();
    return rows.map((r) => ({
      name: r._id,
      country: r.country,
      count: r.count,
      image: r.image ?? '',
      startingFrom: typeof r.minPrice === 'number' ? { amount: r.minPrice, currency: CURRENCY } : null,
    }));
  }

  private async countriesSummary() {
    const rows = await this.holidays
      .aggregate<Lean>([
        { $match: this.listable },
        { $sort: { popularity: -1, _id: 1 } },
        {
          $group: {
            _id: '$country',
            count: { $sum: 1 },
            image: { $first: { $arrayElemAt: ['$images.url', 0] } },
            cities: { $push: '$destinations' },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: HOME_COUNTRY_LIMIT },
      ])
      .exec();
    return rows.map((r) => ({
      name: r._id,
      count: r.count,
      image: r.image ?? '',
      cities: [...new Set<string>((r.cities as string[][]).flat())],
    }));
  }

  private async homeCollections() {
    const defs = await this.collections
      .find({ published: true })
      .sort({ order: 1, _id: 1 })
      .limit(HOME_COLLECTION_LIMIT)
      .lean()
      .exec();
    if (!defs.length) return [];
    const slugs = defs.map((d) => d.slug);

    const groups = await this.holidays
      .aggregate<{ _id: string; items: Lean[] }>([
        { $match: { ...this.listable, collections: { $in: slugs } } },
        { $sort: { popularity: -1, _id: 1 } },
        { $project: CARD_AGG_PROJECTION },
        { $unwind: '$collections' },
        { $match: { collections: { $in: slugs } } },
        { $group: { _id: '$collections', items: { $push: '$$ROOT' } } },
        { $project: { items: { $slice: ['$items', COLLECTION_ITEM_LIMIT] } } },
      ])
      .exec();
    const bySlug = new Map(groups.map((g) => [g._id, g.items]));

    return defs
      .map((d) => ({
        slug: d.slug,
        title: d.title,
        subtitle: d.subtitle,
        items: (bySlug.get(d.slug) ?? []).map((item) => this.toCard(item)),
      }))
      .filter((c) => c.items.length > 0);
  }

  private money(value?: { amount: number; currency: string } | null) {
    return value ? { amount: value.amount, currency: value.currency } : null;
  }

  private toCard(doc: Lean) {
    return {
      id: String(doc._id),
      slug: doc.slug,
      title: doc.title,
      coverImage: doc.images?.[0]?.url ?? '',
      destinations: doc.destinations ?? [],
      country: doc.country,
      durationNights: doc.durationNights,
      durationDays: doc.durationDays,
      price: this.money(doc.price),
      salePrice: this.money(doc.salePrice),
      rating: doc.rating ? { average: doc.rating.average, count: doc.rating.count } : null,
      themes: doc.themes ?? [],
      allowAddToCart: Boolean(doc.allowAddToCart),
    };
  }

  private toPackage(doc: Lean, includeSampleFlag: boolean, admin = false) {
    return {
      ...this.toCard(doc),
      coverImage: doc.images?.[0]?.url ?? '',
      summary: doc.summary ?? '',
      description: doc.description ?? '',
      images: ((doc.images ?? []) as Lean[]).map((i) => ({ url: i.url, alt: i.alt })),
      highlights: doc.highlights ?? [],
      inclusions: doc.inclusions ?? [],
      exclusions: doc.exclusions ?? [],
      itinerary: ((doc.itinerary ?? []) as Lean[]).map((d) => ({
        day: d.day,
        title: d.title,
        description: d.description,
        bulletPoints: d.bulletPoints ?? [],
      })),
      collections: doc.collections ?? [],
      ...(includeSampleFlag ? { isSample: Boolean(doc.isSample) } : {}),
      ...(admin ? { published: doc.published, popularity: doc.popularity, allowAddToCart: Boolean(doc.allowAddToCart) } : {}),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  /** Public lead capture. Returns `{ id, reference, status }`. */
  async createEnquiry(slug: string, dto: CreateHolidayEnquiryDto, userId?: string) {
    const holiday = await this.holidays
      .findOne({ slug, ...this.visible })
      .select({ _id: 1, slug: 1, destinations: 1, country: 1 })
      .lean<{ _id: Types.ObjectId; slug: string; destinations?: string[]; country?: string }>()
      .exec();

    const holidayId = holiday?._id || new Types.ObjectId();
    const holidaySlug = holiday?.slug || slug;

    if (dto.children !== undefined && dto.childAges && dto.childAges.length !== dto.children) {
      throw new BadRequestException('childAges must contain one age for every child');
    }
    if (dto.returnDate && dto.travelDate && dto.returnDate < dto.travelDate) {
      throw new BadRequestException('returnDate must be on or after travelDate');
    }

    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        const reference = dto.reference || `HOL-${Math.floor(100000 + Math.random() * 900000)}`;
        const created = await this.enquiries.create({
          holidayId,
          holidaySlug,
          reference,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          travelers: dto.travelers || 1,
          travelDate: dto.travelDate,
          totalAmount: dto.totalAmount,
          currency: dto.currency || 'AED',
          message: dto.message || dto.notes,
          consentAt: new Date(),
          ...(dto.nationality ? { nationality: dto.nationality } : {}),
          ...(dto.adults !== undefined ? { adults: dto.adults } : {}),
          ...(dto.children !== undefined ? { children: dto.children } : {}),
          ...(dto.departureCity ? { departureCity: dto.departureCity } : {}),
          destination: holiday?.destinations?.[0] || holiday?.country || holidaySlug,
          ...(dto.returnDate ? { returnDate: new Date(dto.returnDate) } : {}),
          rooms: dto.rooms ?? 1,
          ...(dto.hotelCategory ? { hotelCategory: dto.hotelCategory } : {}),
          ...(dto.childAges ? { childAges: dto.childAges } : {}),
          ...(dto.customization ? { customization: dto.customization } : {}),
          marketingOptOut: Boolean(dto.marketingOptOut),
          ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
        });
        // Also create (or link to) the CRM lead, idempotent by reference. Never fails the enquiry.
        await this.leads.captureSafe(fromHolidayEnquiry(created.toObject()));
        return { id: String(created._id), reference: created.reference, status: created.status };
      } catch (error) {
        if ((error as { code?: number })?.code === 11000) continue;
        throw error;
      }
    }
    throw new BadRequestException('Could not record booking enquiry, please try again');
  }

  async listEnquiries(query: ListHolidayEnquiriesDto) {
    const filter = query.status ? { status: query.status } : {};
    const [docs, total] = await Promise.all([
      this.enquiries
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<Lean[]>()
        .exec(),
      this.enquiries.countDocuments(filter).exec(),
    ]);
    return {
      items: docs.map((doc) => this.toEnquiry(doc)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async updateEnquiry(id: string, dto: UpdateHolidayEnquiryStatusDto) {
    const changes: Record<string, unknown> = { status: dto.status };
    if (dto.note !== undefined) changes.note = dto.note;
    const updated = await this.enquiries
      .findByIdAndUpdate(id, { $set: changes }, { returnDocument: 'after', runValidators: true })
      .lean<Lean>()
      .exec();
    if (!updated) throw new NotFoundException('Enquiry not found');
    return this.toEnquiry(updated);
  }

  private toEnquiry(doc: Lean) {
    return {
      id: String(doc._id),
      reference: doc.reference,
      holidayId: String(doc.holidayId),
      holidaySlug: doc.holidaySlug,
      fullName: doc.fullName,
      email: doc.email,
      phone: doc.phone,
      travelers: doc.travelers,
      travelDate: doc.travelDate ?? null,
      totalAmount: doc.totalAmount ?? null,
      currency: doc.currency ?? 'AED',
      message: doc.message ?? null,
      departureCity: doc.departureCity ?? null,
      destination: doc.destination ?? null,
      returnDate: doc.returnDate ? new Date(doc.returnDate).toISOString() : null,
      rooms: doc.rooms ?? 1,
      hotelCategory: doc.hotelCategory ?? null,
      childAges: doc.childAges ?? [],
      customization: doc.customization ?? null,
      userId: doc.userId ? String(doc.userId) : null,
      status: doc.status,
      note: doc.note ?? null,
      bookingReference: doc.bookingReference ?? null,
      consentAt: doc.consentAt ? new Date(doc.consentAt).toISOString() : null,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }
}
