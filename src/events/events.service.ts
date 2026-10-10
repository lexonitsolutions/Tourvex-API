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
import { fromEventEnquiry } from '../leads/leads.rules';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreateEventEnquiryDto } from './dto/create-enquiry.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  ListEventEnquiriesDto,
  UpdateEventEnquiryStatusDto,
} from './dto/update-enquiry-status.dto';
import {
  buildEventFilter,
  buildEventSort,
  derivePrice,
  generateEventReference,
  isUpcomingSessionId,
  MAX_SESSIONS,
  normalizeSessions,
  PRICE_EXPR,
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
  startOfTodayUtc,
  upcomingSessions,
  upcomingStartsExpr,
  validateSessions,
} from './events.utils';
import { EventBanner } from './schemas/event-banner.schema';
import { EventEnquiry } from './schemas/event-enquiry.schema';
import { Event } from './schemas/event.schema';

const CURRENCY = 'AED';
const HOME_BANNER_LIMIT = 10;
const HOME_LIST_LIMIT = 20;
const HOME_TRENDING_CITIES = 3;
const HAPPENING_SOON_DAYS = 30;
const SECTION_ITEM_LIMIT = 12;
const RELATED_LIMIT = 6;
const FACET_LIMIT = 20;
const MONTH_FACET_LIMIT = 24;
const REFERENCE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

/** Fields needed to render an EventCard (cards are derived from these in `toCard`). */
const CARD_FIELDS = {
  slug: 1,
  title: 1,
  coverImage: 1,
  category: 1,
  venue: 1,
  city: 1,
  country: 1,
  durationMinutes: 1,
  'sessions.startsAt': 1,
  'ticketTypes.price': 1,
  price: 1,
  tags: 1,
  published: 1,
  isSample: 1,
  updatedAt: 1,
};

type Lean = Record<string, any>;

@Injectable()
export class EventsService {
  private readonly showSamples: boolean;
  private readonly isProduction: boolean;

  constructor(
    @InjectModel(Event.name) private readonly events: Model<Event>,
    @InjectModel(EventBanner.name) private readonly banners: Model<EventBanner>,
    @InjectModel(EventEnquiry.name) private readonly enquiries: Model<EventEnquiry>,
    private readonly leads: LeadsService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.showSamples = shouldExposeSamples(nodeEnv, config.get<string>('EVENTS_ALLOW_SAMPLES'));
  }

  private get visible() {
    return publicVisibilityFilter(this.showSamples);
  }

  /** Visible AND still bookable somewhere: what public lists show. Detail pages and enquiries use `visible`, so a sold-out product still opens. */
  private get listable() {
    return { ...this.visible, 'stockStatus.soldOut': { $ne: true } };
  }

  /** Visible events that still have at least one upcoming session. */
  private upcomingVisible(now: Date) {
    return { ...this.listable, 'sessions.startsAt': { $gte: startOfTodayUtc(now) } };
  }

  home() {
    return this.cache.wrap('events', 'home', 60, () => this.homeUncached());
  }

  private async homeUncached() {
    const now = new Date();
    const match = this.upcomingVisible(now);
    const [banners, categories, cities, soon] = await Promise.all([
      this.banners
        .find({ published: true })
        .sort({ order: 1, _id: 1 })
        .limit(HOME_BANNER_LIMIT)
        .lean()
        .exec(),
      this.group(match, 'category'),
      this.group(match, 'city'),
      this.happeningSoon(now),
    ]);

    const trending = await Promise.all(
      cities.slice(0, HOME_TRENDING_CITIES).map(async (city) => {
        const items = await this.events
          .find({ ...match, city: city._id }, CARD_FIELDS)
          .sort({ popularity: -1, title: 1, _id: 1 })
          .limit(SECTION_ITEM_LIMIT)
          .lean<Lean[]>()
          .exec();
        return {
          slug: `trending-${slugify(city._id)}`,
          title: `Trending in ${city._id}`,
          subtitle: `Popular events coming up in ${city._id}, ${city.country}`,
          city: city._id,
          items: items.map((item) => this.toCard(item, now)),
        };
      }),
    );

    const sections = [
      {
        slug: 'happening-soon',
        title: 'Happening soon',
        subtitle: `Events in the next ${HAPPENING_SOON_DAYS} days`,
        items: soon.map((item) => this.toCard(item, now)),
      },
      ...trending,
    ];

    const from = (value: number | null) =>
      typeof value === 'number' ? { amount: value, currency: CURRENCY } : null;
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
      categories: categories.map((c) => ({
        name: c._id,
        slug: slugify(c._id),
        count: c.count,
        image: c.image,
        startingFrom: from(c.from),
      })),
      cities: cities.map((c) => ({
        name: c._id,
        country: c.country,
        count: c.count,
        image: c.image,
        startingFrom: from(c.from),
      })),
      sections: sections.filter((s) => s.items.length > 0),
      currency: CURRENCY,
    };
  }

  /** Groups visible upcoming events by a field: most events first, image of the most popular one. */
  private group(match: Record<string, unknown>, field: 'category' | 'city') {
    return this.events
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
            _id: `$${field}`,
            country: { $first: '$country' },
            count: { $sum: 1 },
            image: { $first: '$coverImage' },
            from: { $min: '$_price' },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: HOME_LIST_LIMIT },
      ])
      .exec();
  }

  /** Visible events with a session in the next 30 days, soonest first. */
  private happeningSoon(now: Date) {
    const today = startOfTodayUtc(now);
    return this.events
      .aggregate<Lean>([
        {
          $match: {
            ...this.listable,
            sessions: {
              $elemMatch: {
                startsAt: {
                  $gte: today,
                  $lt: new Date(now.getTime() + HAPPENING_SOON_DAYS * DAY_MS),
                },
              },
            },
          },
        },
        { $addFields: { _next: { $min: upcomingStartsExpr(now) } } },
        { $sort: { _next: 1, popularity: -1, _id: 1 } },
        { $limit: SECTION_ITEM_LIMIT },
        { $project: CARD_FIELDS },
      ])
      .exec();
  }

  list(query: ListEventsDto, admin = false) {
    if (admin) return this.listUncached(query, admin);
    return this.cache.wrap('events', `list:${JSON.stringify(query)}`, 60, () => this.listUncached(query, admin));
  }

  private async listUncached(query: ListEventsDto, admin = false) {
    const now = new Date();
    const base = admin ? adminCatalogFilter(query) : this.listable;
    const filter = buildEventFilter(query, base, now, !admin);
    const { addFields, sort } = buildEventSort(query.sort, now);
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
      this.events.aggregate<Lean>(pipeline).exec(),
      this.events.countDocuments(filter).exec(),
      this.facets(base, now),
    ]);
    return {
      items: docs.map((doc) =>
        admin
          ? { ...this.toCard(doc, now), ...this.adminFlags(doc) }
          : this.toCard(doc, now),
      ),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
      facets,
      currency: query.currency,
    };
  }

  findBySlug(slug: string, currency = CURRENCY) {
    return this.cache.wrap('events', `slug:${slug}:${currency}`, 60, () => this.findBySlugUncached(slug, currency));
  }

  private async findBySlugUncached(slug: string, currency = CURRENCY) {
    const now = new Date();
    const doc = await this.events
      .findOne({ slug, ...this.visible })
      .lean<Lean>()
      .exec();
    if (!doc) throw new NotFoundException('Event not found');

    const related = await this.events
      .find(
        {
          _id: { $ne: doc._id },
          ...this.upcomingVisible(now),
          $or: [{ city: doc.city }, { category: doc.category }],
        },
        CARD_FIELDS,
      )
      .sort({ popularity: -1, title: 1, _id: 1 })
      .limit(RELATED_LIMIT)
      .lean<Lean[]>()
      .exec();

    return {
      event: { ...this.toEvent(doc, now, !this.isProduction), stock: publicStock(doc.stockStatus) },
      related: related.map((r) => this.toCard(r, now)),
      currency,
    };
  }

  async create(dto: CreateEventDto) {
    const result = await this.createUncached(dto);
    await this.cache.invalidate('events');
    return result;
  }

  private async createUncached(dto: CreateEventDto) {
    const slug = dto.slug ?? slugify(dto.title);
    if (!slug) throw new BadRequestException('Could not derive a slug from the title; provide one');
    this.assertSessions(dto.sessions);
    try {
      const created = await this.events.create({
        ...dto,
        slug,
        sessions: normalizeSessions(dto.sessions),
      } as unknown as Partial<Event>);
      return this.toEvent(created.toObject(), new Date(), true, true);
    } catch (error) {
      throw this.mapWriteError(error, slug);
    }
  }

  async update(id: string, dto: UpdateEventDto) {
    const result = await this.updateUncached(id, dto);
    await this.cache.invalidate('events');
    return result;
  }

  private async updateUncached(id: string, dto: UpdateEventDto) {
    this.assertSessions(dto.sessions);
    const changes: Record<string, unknown> = { ...dto };
    if (dto.sessions !== undefined) changes.sessions = normalizeSessions(dto.sessions);
    try {
      const updated = await this.events
        .findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true })
        .lean<Lean>()
        .exec();
      if (!updated) throw new NotFoundException('Event not found');
      return this.toEvent(updated, new Date(), true, true);
    } catch (error) {
      throw this.mapWriteError(error, dto.slug);
    }
  }

  async remove(id: string) {
    const result = await this.removeUncached(id);
    await this.cache.invalidate('events');
    return result;
  }

  private async removeUncached(id: string) {
    const deleted = await this.events.findByIdAndDelete(id).select({ _id: 1 }).lean().exec();
    if (!deleted) throw new NotFoundException('Event not found');
    return { id, deleted: true };
  }

  /** Public lead capture. Returns only `{ id, reference, status }`; never echoes personal data. */
  async createEnquiry(slug: string, dto: CreateEventEnquiryDto, userId?: string) {
    const event = await this.events
      .findOne({ slug, ...this.visible })
      .select({ _id: 1, slug: 1, sessions: 1 })
      .lean<{
        _id: Types.ObjectId;
        slug: string;
        sessions: { _id: Types.ObjectId; startsAt: Date }[];
      }>()
      .exec();
    if (!event) throw new NotFoundException('Event not found');

    if (dto.sessionId && !isUpcomingSessionId(dto.sessionId, event.sessions)) {
      throw new BadRequestException("sessionId must be one of the event's upcoming sessions");
    }

    // Store only the listed fields; `consent` is recorded as the `consentAt` timestamp.
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        const created = await this.enquiries.create({
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          tickets: dto.tickets,
          ...(dto.ticketType ? { ticketType: dto.ticketType } : {}),
          ...(dto.sessionId ? { sessionId: new Types.ObjectId(dto.sessionId) } : {}),
          ...(dto.message ? { message: dto.message } : {}),
          eventId: event._id,
          eventSlug: event.slug,
          reference: generateEventReference(),
          consentAt: new Date(),
          ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
        });
        // Also create (or link to) the CRM lead, idempotent by reference. Never fails the enquiry.
        await this.leads.captureSafe(fromEventEnquiry(created.toObject()));
        return { id: String(created._id), reference: created.reference, status: created.status };
      } catch (error) {
        // The only unique index on this collection is `reference`: retry with a fresh one.
        if (!this.isDuplicateKey(error)) throw error;
      }
    }
    throw new InternalServerErrorException('Could not record the enquiry, please try again');
  }

  async listEnquiries(query: ListEventEnquiriesDto) {
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

  async updateEnquiry(id: string, dto: UpdateEventEnquiryStatusDto) {
    const changes: Record<string, unknown> = { status: dto.status };
    if (dto.note !== undefined) changes.note = dto.note;
    const updated = await this.enquiries
      .findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true })
      .lean<Lean>()
      .exec();
    if (!updated) throw new NotFoundException('Enquiry not found');
    return this.toEnquiry(updated);
  }

  private assertSessions(sessions: Parameters<typeof validateSessions>[0]) {
    const problem = validateSessions(sessions);
    if (problem) throw new BadRequestException(problem);
  }

  private isDuplicateKey(error: unknown): boolean {
    return (error as { code?: number } | null)?.code === 11000;
  }

  /** Raw stored record for the admin editor, including unpublished and sample records. */
  async getAdmin(id: string) {
    const doc = await this.events.findById(id).lean<Lean>().exec();
    if (!doc) throw new NotFoundException('Event not found');
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
      return new ConflictException(`An event with slug "${slug ?? ''}" already exists`);
    }
    return error;
  }

  /** Facets over the events that have an upcoming session (each event counted once). */
  private async facets(base: Record<string, unknown>, now: Date) {
    const floor = startOfTodayUtc(now);
    const count = (field: string, limit: number): PipelineStage.FacetPipelineStage[] => [
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
      { $project: { _id: 0, name: '$_id', count: 1 } },
    ];
    const [result] = await this.events
      .aggregate<Record<'cities' | 'categories' | 'months', { name: string; count: number }[]>>([
        { $match: { ...base, 'sessions.startsAt': { $gte: floor } } },
        {
          $facet: {
            cities: count('city', FACET_LIMIT),
            categories: count('category', FACET_LIMIT),
            months: [
              {
                $project: {
                  months: {
                    $setUnion: [
                      {
                        $map: {
                          input: upcomingStartsExpr(now),
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
    return {
      cities: result?.cities ?? [],
      categories: (result?.categories ?? []).map((c) => ({ ...c, slug: slugify(c.name) })),
      months: result?.months ?? [],
    };
  }

  private money(value?: { amount: number; currency: string } | null) {
    return value ? { amount: value.amount, currency: value.currency } : null;
  }

  private toCard(doc: Lean, now: Date) {
    const upcoming = upcomingSessions(doc.sessions, now);
    return {
      id: String(doc._id),
      slug: doc.slug,
      title: doc.title,
      coverImage: doc.coverImage,
      category: doc.category,
      venue: doc.venue,
      city: doc.city,
      country: doc.country,
      // null only when an event has no upcoming session (detail and admin views).
      nextDate: upcoming[0] ? new Date(upcoming[0].startsAt as Date).toISOString() : null,
      sessionCount: upcoming.length,
      durationMinutes: doc.durationMinutes ?? null,
      price: derivePrice(doc),
      tags: doc.tags ?? [],
    };
  }

  private toEvent(doc: Lean, now: Date, includeSampleFlag: boolean, admin = false) {
    return {
      ...this.toCard(doc, now),
      summary: doc.summary ?? '',
      description: doc.description ?? '',
      images: ((doc.images ?? []) as Lean[]).map((i) => ({ url: i.url, alt: i.alt })),
      sessions: upcomingSessions(doc.sessions as Lean[], now, MAX_SESSIONS).map((s) => ({
        id: String(s._id),
        startsAt: new Date(s.startsAt).toISOString(),
        ...(s.doorsOpenAt ? { doorsOpenAt: new Date(s.doorsOpenAt).toISOString() } : {}),
      })),
      ticketTypes: ((doc.ticketTypes ?? []) as Lean[]).map((t) => ({
        type: t.type,
        description: t.description ?? '',
        price: this.money(t.price),
      })),
      highlights: doc.highlights ?? [],
      inclusions: doc.inclusions ?? [],
      exclusions: doc.exclusions ?? [],
      ageGuidance: doc.ageGuidance ?? '',
      venueAddress: doc.venueAddress ?? '',
      notes: doc.notes ?? '',
      ...(includeSampleFlag ? { isSample: Boolean(doc.isSample) } : {}),
      ...(admin ? { published: doc.published, popularity: doc.popularity } : {}),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  /** Admin-only view; contains the visitor's personal data. */
  private toEnquiry(doc: Lean) {
    return {
      id: String(doc._id),
      reference: doc.reference,
      eventId: String(doc.eventId),
      eventSlug: doc.eventSlug,
      fullName: doc.fullName,
      email: doc.email,
      phone: doc.phone,
      tickets: doc.tickets,
      ticketType: doc.ticketType ?? null,
      sessionId: doc.sessionId ? String(doc.sessionId) : null,
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
