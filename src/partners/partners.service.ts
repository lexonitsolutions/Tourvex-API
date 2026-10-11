import { CacheService } from '../common/cache/cache.service';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { ListPartnersDto } from './dto/list-partners.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import {
  PARTNERS_SUBTITLE,
  PARTNERS_TITLE,
  buildPartnerFilter,
  shouldExposeSamples,
} from './partners.utils';
import { Partner } from './schemas/partner.schema';

type Lean = Record<string, any>;

const NAME_COLLATION = { locale: 'en', strength: 2 } as const;

@Injectable()
export class PartnersService {
  private readonly showSamples: boolean;

  constructor(
    @InjectModel(Partner.name) private readonly partners: Model<Partner>,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.showSamples = shouldExposeSamples(
      config.get<string>('NODE_ENV'),
      config.get<string>('PARTNERS_ALLOW_SAMPLES'),
    );
  }

  list(query: ListPartnersDto) {
    return this.cache.wrap('partners', `list:${JSON.stringify(query)}`, 60, () => this.listUncached(query));
  }

  private async listUncached(query: ListPartnersDto) {
    const docs = await this.partners
      .find(buildPartnerFilter(query.placement, this.showSamples))
      .sort({ order: 1, name: 1 })
      .collation(NAME_COLLATION)
      .limit(query.limit)
      .lean<Lean[]>()
      .exec();
    return {
      title: PARTNERS_TITLE,
      subtitle: PARTNERS_SUBTITLE,
      items: docs.map((d) => ({
        id: String(d._id),
        name: d.name,
        logo: d.logo ?? null,
        category: d.category,
        href: d.href ?? null,
      })),
    };
  }

  async listAll() {
    const docs = await this.partners
      .find({})
      .sort({ order: 1, name: 1 })
      .collation(NAME_COLLATION)
      .lean<Lean[]>()
      .exec();
    return { items: docs.map((d) => this.toAdmin(d)) };
  }

  async create(dto: CreatePartnerDto) {
    const result = await this.createUncached(dto);
    await this.cache.invalidate('partners');
    return result;
  }

  private async createUncached(dto: CreatePartnerDto) {
    try {
      const created = await this.partners.create({ ...dto });
      return this.toAdmin(created.toObject());
    } catch (error) {
      throw this.mapWriteError(error, dto.name);
    }
  }

  async update(id: string, dto: UpdatePartnerDto) {
    const result = await this.updateUncached(id, dto);
    await this.cache.invalidate('partners');
    return result;
  }

  private async updateUncached(id: string, dto: UpdatePartnerDto) {
    try {
      const updated = await this.partners
        .findByIdAndUpdate(id, { $set: { ...dto } }, { returnDocument: 'after', runValidators: true })
        .lean<Lean>()
        .exec();
      if (!updated) throw new NotFoundException('Partner not found');
      return this.toAdmin(updated);
    } catch (error) {
      throw this.mapWriteError(error, dto.name);
    }
  }

  async remove(id: string) {
    const result = await this.removeUncached(id);
    await this.cache.invalidate('partners');
    return result;
  }

  private async removeUncached(id: string) {
    const deleted = await this.partners.findByIdAndDelete(id).select({ _id: 1 }).lean().exec();
    if (!deleted) throw new NotFoundException('Partner not found');
    return { id, deleted: true };
  }

  private toAdmin(d: Lean) {
    return {
      id: String(d._id),
      name: d.name,
      logo: d.logo ?? null,
      href: d.href ?? null,
      category: d.category,
      placements: d.placements,
      order: d.order,
      published: d.published,
      isSample: d.isSample,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private mapWriteError(error: unknown, name?: string) {
    if ((error as { code?: number } | null)?.code === 11000) {
      return new ConflictException(`A partner named "${name ?? ''}" already exists`);
    }
    return error;
  }
}
