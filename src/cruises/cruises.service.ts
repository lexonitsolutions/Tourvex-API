import { CacheService } from '../common/cache/cache.service';
import { adminCatalogFilter, toAdminRecord } from '../common/catalog/admin-catalog';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from '../leads/leads.service';
import { publicStock } from '../stock/stock.rules';
import { fromCruiseEnquiry } from '../leads/leads.rules';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  buildCruiseFilter,
  buildCruiseSort,
  derivePorts,
  derivePrice,
  generateCruiseReference,
  isUpcomingDeparture,
  MAX_DEPARTURES,
  NEXT_DEPARTURES,
  normalizeDepartureDates,
  PRICE_EXPR,
  publicVisibilityFilter,
  resolveDurationDays,
  shouldExposeSamples,
  slugify,
  startOfTodayUtc,
  upcomingDepartures,
  validateItinerary,
} from './cruises.utils';
import { CreateCruiseEnquiryDto } from './dto/create-enquiry.dto';
import { CreateCruiseDto } from './dto/create-cruise.dto';
import { ListCruisesDto } from './dto/list-cruises.dto';
import { ListCruiseEnquiriesDto, UpdateCruiseEnquiryStatusDto } from './dto/update-enquiry-status.dto';
import { UpdateCruiseDto } from './dto/update-cruise.dto';
import { CruiseBanner } from './schemas/cruise-banner.schema';
import { CruiseEnquiry } from './schemas/cruise-enquiry.schema';
import { Cruise } from './schemas/cruise.schema';

const CURRENCY = 'AED';
const HOME_BANNER_LIMIT = 10;
const HOME_CITY_LIMIT = 20;
const HOME_SECTION_CITIES = 4;
const SECTION_ITEM_LIMIT = 12;
const LINE_LIMIT = 50;
const RELATED_LIMIT = 6;
const FACET_LIMIT = 20;
const MONTH_FACET_LIMIT = 24;
const REFERENCE_ATTEMPTS = 5;

/** Fields needed to render a CruiseCard (cards are derived from these in `toCard`). */
const CARD_FIELDS = {
  slug: 1,
  title: 1,
  coverImage: 1,
  cruiseLine: 1,
  shipName: 1,
  departureCity: 1,
  departureCountry: 1,
  region: 1,
  durationNights: 1,
  durationDays: 1,
  departures: 1,
  'itinerary.port': 1,
  'itinerary.type': 1,
  'cabins.fromPrice': 1,
  price: 1,
  tags: 1,
  published: 1,
  allowAddToCart: 1,
  isSample: 1,
  updatedAt: 1,
};

type Lean = Record<string, any>;

@Injectable()
export class CruisesService {
  private readonly showSamples: boolean;
  private readonly isProduction: boolean;

  constructor(
    @InjectModel(Cruise.name) private readonly cruises: Model<Cruise>,
    @InjectModel(CruiseBanner.name) private readonly banners: Model<CruiseBanner>,
    @InjectModel(CruiseEnquiry.name) private readonly enquiries: Model<CruiseEnquiry>,
    private readonly leads: LeadsService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.showSamples = shouldExposeSamples(nodeEnv, config.get<string>('CRUISES_ALLOW_SAMPLES'));
  }

  private get visible() {
    return publicVisibilityFilter(this.showSamples);
  }

  /** Visible AND still bookable somewhere: what public lists show. Detail pages and enquiries use `visible`, so a sold-out product still opens. */
  private get listable() {
    return { ...this.visible, 'stockStatus.soldOut': { $ne: true } };
  }

  /** Visible cruises that still have at least one upcoming departure. */
  private upcomingVisible(now: Date) {
    return { ...this.listable, departures: { $gte: startOfTodayUtc(now) } };
  }

  home() {
    return this.cache.wrap('cruises', 'home', 60, () => this.homeUncached());
  }

  private async homeUncached() {
    const now = new Date();
    const match = this.upcomingVisible(now);
    const [banners, cities, countries, lines] = await Promise.all([
      this.banners
        .find({ published: true })
        .sort({ order: 1, _id: 1 })
        .limit(HOME_BANNER_LIMIT)
        .lean()
        .exec(),
      this.cruises
        .aggregate<{
          _id: string;
          country: string;
          count: number;
          image: string;
          from: number | null;
        }>([
          { $match: match },
          { $addFields: { _price: PRICE_EXPR } },
          { $sort: { popularity: -1, _id: 1 } },
          {
            $group: {
              _id: '$departureCity',
              country: { $first: '$departureCountry' },
              count: { $sum: 1 },
              image: { $first: '$coverImage' },
              from: { $min: '$_price' },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: HOME_CITY_LIMIT },
        ])
        .exec(),
      this.cruises
        .aggregate<{ _id: string; count: number; image: string; cities: string[] }>([
          { $match: match },
          { $sort: { popularity: -1, _id: 1 } },
          {
            $group: {
              _id: '$departureCountry',
              count: { $sum: 1 },
              image: { $first: '$coverImage' },
              cities: { $push: '$departureCity' },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: HOME_CITY_LIMIT },
        ])
        .exec(),
      this.cruises
        .aggregate<{ _id: string }>([
          { $match: match },
          { $group: { _id: '$cruiseLine' } },
          { $sort: { _id: 1 } },
          { $limit: LINE_LIMIT },
        ])
        .collation({ locale: 'en', strength: 1 })
        .exec(),
    ]);

    const sections = await Promise.all(
      cities.slice(0, HOME_SECTION_CITIES).map(async (city) => {
        const items = await this.cruises
          .find({ ...match, departureCity: city._id }, CARD_FIELDS)
          .sort({ popularity: -1, title: 1, _id: 1 })
          .limit(SECTION_ITEM_LIMIT)
          .lean<Lean[]>()
          .exec();
        return {
          slug: `from-${slugify(city._id)}`,
          title: `Best sellers from ${city._id}`,
          subtitle: `Sailings departing ${city._id}, ${city.country}`,
          city: city._id,
          items: items.map((item) => this.toCard(item, now)),
        };
      }),
    );

    return {
      banners: banners.map((b) => ({
        id: String(b._id),
        ...(b.eyebrow ? { eyebrow: b.eyebrow } : {}),
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        image: b.image,
        ctaLabel: b.ctaLabel,
        ctaHref: b.ctaHref,
      })),
      cities: cities.map((c) => ({
        name: c._id,
        country: c.country,
        count: c.count,
        image: c.image,
        startingFrom: typeof c.from === 'number' ? { amount: c.from, currency: CURRENCY } : null,
      })),
      countries: countries.map((c) => ({
        name: c._id,
        count: c.count,
        image: c.image,
        cities: [...new Set(c.cities)],
      })),
      sections: sections.filter((s) => s.items.length > 0),
      lines: lines.map((l) => l._id),
      currency: CURRENCY,
    };
  }

  list(query: ListCruisesDto, admin = false) {
    if (admin) return this.listUncached(query, admin);
    return this.cache.wrap('cruises', `list:${JSON.stringify(query)}`, 60, () => this.listUncached(query, admin));
  }

  private async listUncached(query: ListCruisesDto, admin = false) {
    const now = new Date();
    const base = admin ? adminCatalogFilter(query) : this.listable;
    const filter = buildCruiseFilter(query, base, now, !admin);
    const { addFields, sort } = buildCruiseSort(query.sort, now);
    const skip = (query.page - 1) * query.limit;

    const pipeline: PipelineStage[] = [{ $match: filter }];
    if (addFields) pipeline.push({ $addFields: addFields as any });
    pipeline.push(
      { $sort: sort },
      { $skip: skip },
      { $limit: query.limit },
      { $project: CARD_FIELDS },
    );

    const [docs, total, facets] = await Promise.all([
      this.cruises.aggregate<Lean>(pipeline).exec(),
      this.cruises.countDocuments(filter).exec(),
      this.facets(base, now, !admin),
    ]);
    return {
      items: docs.map((doc) =>
        admin
          ? { ...this.toCard(doc, now), ...this.adminFlags(doc) }
          : this.toCard(doc, now),
      ),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
      facets,
      currency: query.currency,
    };
  }

  findBySlug(slug: string, currency = CURRENCY) {
    return this.cache.wrap('cruises', `slug:${slug}:${currency}`, 60, () => this.findBySlugUncached(slug, currency));
  }

  private async findBySlugUncached(slug: string, currency = CURRENCY) {
    const now = new Date();
    const doc = await this.cruises
      .findOne({ slug, ...this.visible })
      .lean<Lean>()
      .exec();
    if (!doc) throw new NotFoundException('Cruise not found');

    const related = await this.cruises
      .find(
        {
          _id: { $ne: doc._id },
          ...this.upcomingVisible(now),
          $or: [{ departureCity: doc.departureCity }, { region: doc.region }],
        },
        CARD_FIELDS,
      )
      .sort({ popularity: -1, title: 1, _id: 1 })
      .limit(RELATED_LIMIT)
      .lean<Lean[]>()
      .exec();

    return {
      cruise: { ...this.toCruise(doc, now, !this.isProduction), stock: publicStock(doc.stockStatus) },
      related: related.map((r) => this.toCard(r, now)),
      currency,
    };
  }

  async create(dto: CreateCruiseDto) {
    const result = await this.createUncached(dto);
    await this.cache.invalidate('cruises');
    return result;
  }

  private async createUncached(dto: CreateCruiseDto) {
    const slug = dto.slug ?? slugify(dto.title);
    if (!slug) throw new BadRequestException('Could not derive a slug from the title; provide one');
    const durationDays = resolveDurationDays(dto.durationNights, dto.durationDays);
    this.assertItinerary(dto.itinerary, durationDays);
    try {
      const created = await this.cruises.create({
        ...dto,
        slug,
        durationDays,
        departures: normalizeDepartureDates(dto.departures),
      } as unknown as Partial<Cruise>);
      return this.toCruise(created.toObject(), new Date(), true, true);
    } catch (error) {
      throw this.mapWriteError(error, slug);
    }
  }

  async update(id: string, dto: UpdateCruiseDto) {
    const result = await this.updateUncached(id, dto);
    await this.cache.invalidate('cruises');
    return result;
  }

  private async updateUncached(id: string, dto: UpdateCruiseDto) {
    const existing = await this.cruises
      .findById(id)
      .select({ durationNights: 1, durationDays: 1, itinerary: 1 })
      .lean<Lean>()
      .exec();
    if (!existing) throw new NotFoundException('Cruise not found');

    const changes: Record<string, unknown> = { ...dto };
    if (dto.departures !== undefined) changes.departures = normalizeDepartureDates(dto.departures);
    // When only the nights change, durationDays follows (nights + 1) unless given explicitly.
    if (dto.durationNights !== undefined && dto.durationDays === undefined) {
      changes.durationDays = resolveDurationDays(dto.durationNights);
    }
    const durationDays = (changes.durationDays as number | undefined) ?? existing.durationDays;
    this.assertItinerary(dto.itinerary ?? existing.itinerary, durationDays);

    try {
      const updated = await this.cruises
        .findByIdAndUpdate(id, { $set: changes }, { returnDocument: 'after', runValidators: true })
        .lean<Lean>()
        .exec();
      if (!updated) throw new NotFoundException('Cruise not found');
      return this.toCruise(updated, new Date(), true, true);
    } catch (error) {
      throw this.mapWriteError(error, dto.slug);
    }
  }

  async remove(id: string) {
    const result = await this.removeUncached(id);
    await this.cache.invalidate('cruises');
    return result;
  }

  private async removeUncached(id: string) {
    const deleted = await this.cruises.findByIdAndDelete(id).select({ _id: 1 }).lean().exec();
    if (!deleted) throw new NotFoundException('Cruise not found');
    return { id, deleted: true };
  }

  /** Public lead capture. Returns only `{ id, reference, status }`; never echoes personal data. */
  async createEnquiry(slug: string, dto: CreateCruiseEnquiryDto, userId?: string) {
    const cruise = await this.cruises
      .findOne({ slug, ...this.visible })
      .select({ _id: 1, slug: 1, departures: 1 })
      .lean<{ _id: Types.ObjectId; slug: string; departures: Date[] }>()
      .exec();
    if (!cruise) throw new NotFoundException('Cruise not found');

    if (dto.departureDate && !isUpcomingDeparture(dto.departureDate, cruise.departures)) {
      throw new BadRequestException("departureDate must be one of the cruise's upcoming departures");
    }

    // Store only the listed fields; `consent` is recorded as the `consentAt` timestamp.
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        const created = await this.enquiries.create({
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          nationality: dto.nationality,
          adults: dto.adults,
          children: dto.children,
          ...(dto.departureDate ? { departureDate: new Date(dto.departureDate) } : {}),
          ...(dto.cabinType ? { cabinType: dto.cabinType } : {}),
          ...(dto.message ? { message: dto.message } : {}),
          cruiseId: cruise._id,
          cruiseSlug: cruise.slug,
          reference: generateCruiseReference(),
          consentAt: new Date(),
          ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
        });
        // Also create (or link to) the CRM lead, idempotent by reference. Never fails the enquiry.
        await this.leads.captureSafe(fromCruiseEnquiry(created.toObject()));
        return { id: String(created._id), reference: created.reference, status: created.status };
      } catch (error) {
        // The only unique index on this collection is `reference`: retry with a fresh one.
        if (!this.isDuplicateKey(error)) throw error;
      }
    }
    throw new InternalServerErrorException('Could not record the enquiry, please try again');
  }

  async listEnquiries(query: ListCruiseEnquiriesDto) {
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
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
    };
  }

  async updateEnquiry(id: string, dto: UpdateCruiseEnquiryStatusDto) {
    const changes: Record<string, unknown> = { status: dto.status };
    if (dto.note !== undefined) changes.note = dto.note;
    const updated = await this.enquiries
      .findByIdAndUpdate(id, { $set: changes }, { returnDocument: 'after', runValidators: true })
      .lean<Lean>()
      .exec();
    if (!updated) throw new NotFoundException('Enquiry not found');
    return this.toEnquiry(updated);
  }

  private assertItinerary(itinerary: readonly { day: number }[], durationDays: number) {
    const problem = validateItinerary(itinerary, durationDays);
    if (problem) throw new BadRequestException(problem);
  }

  private isDuplicateKey(error: unknown): boolean {
    return (error as { code?: number } | null)?.code === 11000;
  }

  /** Raw stored record for the admin editor, including unpublished and sample records. */
  async getAdmin(id: string) {
    const doc = await this.cruises.findById(id).lean<Lean>().exec();
    if (!doc) throw new NotFoundException('Cruise not found');
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
    if (this.isDuplicateKey(error)) {
      return new ConflictException(`A cruise with slug "${slug ?? ''}" already exists`);
    }
    return error;
  }

  /** Facets over the cruises that have an upcoming departure (each cruise counted once). */
  private async facets(base: Record<string, unknown>, now: Date, upcomingOnly = true) {
    const count = (field: string, limit: number): PipelineStage.FacetPipelineStage[] => [
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
      { $project: { _id: 0, name: '$_id', count: 1 } },
    ];
    const [result] = await this.cruises
      .aggregate<Record<'cities' | 'lines' | 'regions' | 'months', { name: string; count: number }[]>>([
        { $match: upcomingOnly ? { ...base, departures: { $gte: startOfTodayUtc(now) } } : base },
        {
          $facet: {
            cities: count('departureCity', FACET_LIMIT),
            lines: count('cruiseLine', FACET_LIMIT),
            regions: count('region', FACET_LIMIT),
            months: [
              {
                $project: {
                  months: {
                    $setUnion: [
                      {
                        $map: {
                          input: {
                            $filter: {
                              input: '$departures',
                              as: 'd',
                              cond: { $gte: ['$$d', startOfTodayUtc(now)] },
                            },
                          },
                          as: 'd',
                          in: { $dateToString: { format: '%Y-%m', date: '$$d', timezone: 'UTC' } },
                        },
                      },
                      [],
                    ],
                  },
                },
              },
              { $unwind: '$months' },
              { $group: { _id: '$months', count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
              { $limit: MONTH_FACET_LIMIT },
              { $project: { _id: 0, name: '$_id', count: 1 } },
            ],
          },
        },
      ])
      .exec();
    return result ?? { cities: [], lines: [], regions: [], months: [] };
  }

  private money(value?: { amount: number; currency: string } | null) {
    return value ? { amount: value.amount, currency: value.currency } : null;
  }

  private toCard(doc: Lean, now: Date) {
    const { ports, portCount } = derivePorts(doc.itinerary);
    return {
      id: String(doc._id),
      slug: doc.slug,
      title: doc.title,
      coverImage: doc.coverImage,
      cruiseLine: doc.cruiseLine,
      shipName: doc.shipName,
      departureCity: doc.departureCity,
      departureCountry: doc.departureCountry,
      region: doc.region,
      durationNights: doc.durationNights,
      durationDays: doc.durationDays,
      nextDepartures: upcomingDepartures(doc.departures, now, NEXT_DEPARTURES),
      ports,
      portCount,
      price: derivePrice(doc),
      tags: doc.tags ?? [],
      allowAddToCart: Boolean(doc.allowAddToCart),
    };
  }

  private toCruise(doc: Lean, now: Date, includeSampleFlag: boolean, admin = false) {
    return {
      ...this.toCard(doc, now),
      summary: doc.summary ?? '',
      description: doc.description ?? '',
      images: ((doc.images ?? []) as Lean[]).map((i) => ({ url: i.url, alt: i.alt })),
      departures: upcomingDepartures(doc.departures, now, MAX_DEPARTURES),
      itinerary: ((doc.itinerary ?? []) as Lean[]).map((s) => ({
        day: s.day,
        port: s.port,
        ...(s.country ? { country: s.country } : {}),
        type: s.type,
        description: s.description ?? '',
      })),
      cabins: ((doc.cabins ?? []) as Lean[]).map((c) => ({
        type: c.type,
        description: c.description ?? '',
        fromPrice: this.money(c.fromPrice),
      })),
      highlights: doc.highlights ?? [],
      inclusions: doc.inclusions ?? [],
      exclusions: doc.exclusions ?? [],
      notes: doc.notes ?? '',
      ...(includeSampleFlag ? { isSample: Boolean(doc.isSample) } : {}),
      ...(admin ? { published: doc.published, popularity: doc.popularity, allowAddToCart: Boolean(doc.allowAddToCart) } : {}),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  /** Admin-only view; contains the traveller's personal data. */
  private toEnquiry(doc: Lean) {
    return {
      id: String(doc._id),
      reference: doc.reference,
      cruiseId: String(doc.cruiseId),
      cruiseSlug: doc.cruiseSlug,
      fullName: doc.fullName,
      email: doc.email,
      phone: doc.phone,
      nationality: doc.nationality,
      adults: doc.adults,
      children: doc.children,
      departureDate: doc.departureDate ? new Date(doc.departureDate).toISOString() : null,
      cabinType: doc.cabinType ?? null,
      message: doc.message ?? null,
      userId: doc.userId ? String(doc.userId) : null,
      status: doc.status,
      note: doc.note ?? null,
      bookingReference: doc.bookingReference ?? null,
      consentAt: new Date(doc.consentAt).toISOString(),
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }
}
