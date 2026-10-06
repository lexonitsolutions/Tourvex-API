import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from '../leads/leads.service';
import { fromVisaEnquiry } from '../leads/leads.rules';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreateVisaEnquiryDto } from './dto/create-enquiry.dto';
import { CreateVisaDto } from './dto/create-visa.dto';
import { ListVisasDto } from './dto/list-visas.dto';
import { ListVisaEnquiriesDto, UpdateVisaEnquiryStatusDto } from './dto/update-enquiry-status.dto';
import { UpdateVisaDto } from './dto/update-visa.dto';
import { VisaBanner } from './schemas/visa-banner.schema';
import { VisaEnquiry } from './schemas/visa-enquiry.schema';
import { VisaSection } from './schemas/visa-section.schema';
import { Visa } from './schemas/visa.schema';
import {
  buildVisaFilter,
  buildVisaSort,
  generateEnquiryReference,
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
} from './visas.utils';

const CURRENCY = 'AED';
const HOME_BANNER_LIMIT = 10;
const HOME_SECTION_LIMIT = 10;
const SECTION_ITEM_LIMIT = 30;
const RELATED_LIMIT = 6;
const FACET_LIMIT = 10;
const REFERENCE_ATTEMPTS = 5;

/** Fields needed to render a VisaCard. */
const CARD_FIELDS = {
  slug: 1,
  country: 1,
  countryCode: 1,
  title: 1,
  kind: 1,
  startingPrice: 1,
  processing: 1,
  validity: 1,
  published: 1,
  isSample: 1,
};

type Lean = Record<string, any>;

@Injectable()
export class VisasService {
  private readonly showSamples: boolean;
  private readonly isProduction: boolean;

  constructor(
    @InjectModel(Visa.name) private readonly visas: Model<Visa>,
    @InjectModel(VisaSection.name) private readonly sections: Model<VisaSection>,
    @InjectModel(VisaBanner.name) private readonly banners: Model<VisaBanner>,
    @InjectModel(VisaEnquiry.name) private readonly enquiries: Model<VisaEnquiry>,
    private readonly leads: LeadsService,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.showSamples = shouldExposeSamples(nodeEnv, config.get<string>('VISAS_ALLOW_SAMPLES'));
  }

  private get visible() {
    return publicVisibilityFilter(this.showSamples);
  }

  async home() {
    const [banners, sections] = await Promise.all([
      this.banners
        .find({ published: true })
        .sort({ order: 1, _id: 1 })
        .limit(HOME_BANNER_LIMIT)
        .lean()
        .exec(),
      this.homeSections(),
    ]);
    return {
      banners: banners.map((b) => ({
        id: String(b._id),
        ...(b.eyebrow ? { eyebrow: b.eyebrow } : {}),
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        countryCode: b.countryCode,
        ctaLabel: b.ctaLabel,
        ctaHref: b.ctaHref,
      })),
      sections,
      currency: CURRENCY,
    };
  }

  async list(query: ListVisasDto, admin = false) {
    const base = admin ? {} : this.visible;
    const filter = buildVisaFilter(query, base);
    const { addFields, sort, collation } = buildVisaSort(query.sort);
    const skip = (query.page - 1) * query.limit;

    const pipeline: PipelineStage[] = [{ $match: filter }];
    if (addFields) pipeline.push({ $addFields: addFields as any });
    pipeline.push(
      { $sort: sort },
      { $skip: skip },
      { $limit: query.limit },
      { $project: CARD_FIELDS },
    );

    const aggregate = this.visas.aggregate<Lean>(pipeline);
    if (collation) aggregate.collation(collation);

    const [docs, total, kinds] = await Promise.all([
      aggregate.exec(),
      this.visas.countDocuments(filter).exec(),
      this.kindFacets(base),
    ]);
    return {
      items: docs.map((doc) =>
        admin
          ? { ...this.toCard(doc), published: doc.published, isSample: doc.isSample }
          : this.toCard(doc),
      ),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
      facets: { kinds },
      currency: query.currency,
    };
  }

  async findBySlug(slug: string, currency = CURRENCY) {
    const doc = await this.visas
      .findOne({ slug, ...this.visible })
      .lean<Lean>()
      .exec();
    if (!doc) throw new NotFoundException('Visa not found');

    const related = await this.visas
      .find({ _id: { $ne: doc._id }, ...this.visible, kind: doc.kind }, CARD_FIELDS)
      .sort({ popularity: -1, country: 1, _id: 1 })
      .limit(RELATED_LIMIT)
      .lean<Lean[]>()
      .exec();

    return {
      visa: this.toVisa(doc, !this.isProduction),
      related: related.map((r) => this.toCard(r)),
      currency,
    };
  }

  async create(dto: CreateVisaDto) {
    const slug = dto.slug ?? slugify(dto.title);
    if (!slug) throw new BadRequestException('Could not derive a slug from the title; provide one');
    try {
      const created = await this.visas.create({ ...dto, slug });
      return this.toVisa(created.toObject(), true, true);
    } catch (error) {
      throw this.mapWriteError(error, slug);
    }
  }

  async update(id: string, dto: UpdateVisaDto) {
    try {
      const updated = await this.visas
        .findByIdAndUpdate(id, { $set: { ...dto } }, { new: true, runValidators: true })
        .lean<Lean>()
        .exec();
      if (!updated) throw new NotFoundException('Visa not found');
      return this.toVisa(updated, true, true);
    } catch (error) {
      throw this.mapWriteError(error, dto.slug);
    }
  }

  async remove(id: string) {
    const deleted = await this.visas.findByIdAndDelete(id).select({ _id: 1 }).lean().exec();
    if (!deleted) throw new NotFoundException('Visa not found');
    return { id, deleted: true };
  }

  /** Public lead capture. Returns only `{ id, reference, status }`; never echoes personal data. */
  async createEnquiry(slug: string, dto: CreateVisaEnquiryDto, userId?: string) {
    const visa = await this.visas
      .findOne({ slug, ...this.visible })
      .select({ _id: 1, slug: 1 })
      .lean<{ _id: Types.ObjectId; slug: string }>()
      .exec();
    if (!visa) throw new NotFoundException('Visa not found');

    // Store only the listed fields; `consent` is recorded as the `consentAt` timestamp.
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        const created = await this.enquiries.create({
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          nationality: dto.nationality,
          travellers: dto.travellers,
          ...(dto.travelDate ? { travelDate: new Date(dto.travelDate) } : {}),
          ...(dto.message ? { message: dto.message } : {}),
          visaId: visa._id,
          visaSlug: visa.slug,
          reference: generateEnquiryReference(),
          consentAt: new Date(),
          ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
        });
        // Also create (or link to) the CRM lead, idempotent by reference. Never fails the enquiry.
        await this.leads.captureSafe(fromVisaEnquiry(created.toObject()));
        return { id: String(created._id), reference: created.reference, status: created.status };
      } catch (error) {
        // The only unique index on this collection is `reference`: retry with a fresh one.
        if (!this.isDuplicateKey(error)) throw error;
      }
    }
    throw new InternalServerErrorException('Could not record the enquiry, please try again');
  }

  async listEnquiries(query: ListVisaEnquiriesDto) {
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

  async updateEnquiry(id: string, dto: UpdateVisaEnquiryStatusDto) {
    const changes: Record<string, unknown> = { status: dto.status };
    if (dto.note !== undefined) changes.note = dto.note;
    const updated = await this.enquiries
      .findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true })
      .lean<Lean>()
      .exec();
    if (!updated) throw new NotFoundException('Enquiry not found');
    return this.toEnquiry(updated);
  }

  private isDuplicateKey(error: unknown): boolean {
    return (error as { code?: number } | null)?.code === 11000;
  }

  private mapWriteError(error: unknown, slug?: string) {
    if (this.isDuplicateKey(error)) {
      return new ConflictException(`A visa with slug "${slug ?? ''}" already exists`);
    }
    return error;
  }

  private async kindFacets(base: Record<string, unknown>) {
    return this.visas
      .aggregate<{ name: string; count: number }>([
        { $match: base },
        { $group: { _id: '$kind', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: FACET_LIMIT },
        { $project: { _id: 0, name: '$_id', count: 1 } },
      ])
      .exec();
  }

  private async homeSections() {
    const defs = await this.sections
      .find({ published: true })
      .sort({ order: 1, _id: 1 })
      .limit(HOME_SECTION_LIMIT)
      .lean()
      .exec();
    if (!defs.length) return [];
    const slugs = defs.map((d) => d.slug);

    const groups = await this.visas
      .aggregate<{ _id: string; items: Lean[] }>([
        { $match: { ...this.visible, sections: { $in: slugs } } },
        { $sort: { popularity: -1, country: 1, _id: 1 } },
        { $project: { ...CARD_FIELDS, sections: 1 } },
        { $unwind: '$sections' },
        { $match: { sections: { $in: slugs } } },
        { $group: { _id: '$sections', items: { $push: '$$ROOT' } } },
        { $project: { items: { $slice: ['$items', SECTION_ITEM_LIMIT] } } },
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
      .filter((s) => s.items.length > 0);
  }

  private money(value?: { amount: number; currency: string } | null) {
    return value ? { amount: value.amount, currency: value.currency } : null;
  }

  private toCard(doc: Lean) {
    return {
      id: String(doc._id),
      slug: doc.slug,
      country: doc.country,
      countryCode: doc.countryCode,
      title: doc.title,
      kind: doc.kind,
      startingPrice: this.money(doc.startingPrice),
      processing: doc.processing ?? '',
      validity: doc.validity ?? '',
    };
  }

  private toVisa(doc: Lean, includeSampleFlag: boolean, admin = false) {
    return {
      ...this.toCard(doc),
      summary: doc.summary ?? '',
      description: doc.description ?? '',
      entries: doc.entries ?? 'varies',
      stay: doc.stay ?? '',
      highlights: doc.highlights ?? [],
      requirements: doc.requirements ?? [],
      documents: doc.documents ?? [],
      steps: ((doc.steps ?? []) as Lean[]).map((s) => ({ title: s.title, description: s.description })),
      faqs: ((doc.faqs ?? []) as Lean[]).map((f) => ({ question: f.question, answer: f.answer })),
      notes: doc.notes ?? '',
      sections: doc.sections ?? [],
      ...(includeSampleFlag ? { isSample: Boolean(doc.isSample) } : {}),
      ...(admin ? { published: doc.published, popularity: doc.popularity } : {}),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  /** Admin-only view; contains the traveller's personal data. */
  private toEnquiry(doc: Lean) {
    return {
      id: String(doc._id),
      reference: doc.reference,
      visaId: String(doc.visaId),
      visaSlug: doc.visaSlug,
      fullName: doc.fullName,
      email: doc.email,
      phone: doc.phone,
      nationality: doc.nationality,
      travellers: doc.travellers,
      travelDate: doc.travelDate ? new Date(doc.travelDate).toISOString() : null,
      message: doc.message ?? null,
      userId: doc.userId ? String(doc.userId) : null,
      status: doc.status,
      note: doc.note ?? null,
      consentAt: new Date(doc.consentAt).toISOString(),
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }
}
