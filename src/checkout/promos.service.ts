import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { appError } from '../common/app-error';
import { UpdatePromoDto, UpsertPromoDto } from './dto/checkout.dto';
import { PromoCode } from './schemas/promo-code.schema';

/** Staff CRUD for promo codes. Codes are never exposed to customers except the one they type. */
@Injectable()
export class PromosService {
  constructor(@InjectModel(PromoCode.name) private readonly promos: Model<PromoCode>) {}

  list() {
    return this.promos.find().sort({ createdAt: -1 }).lean().exec();
  }

  async create(dto: UpsertPromoDto) {
    this.assertRules(dto);
    try {
      const created = await this.promos.create({ ...dto, appliesTo: dto.appliesTo ?? [] });
      return created.toObject();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw appError(409, 'PROMO_EXISTS', 'A promo code with this name already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdatePromoDto) {
    const current = await this.promos.findById(id).lean().exec();
    if (!current) throw new NotFoundException('Promo code not found');
    this.assertRules({ ...current, ...dto });
    const updated = await this.promos
      .findByIdAndUpdate(id, { $set: dto }, { returnDocument: 'after', runValidators: true })
      .lean()
      .exec();
    return updated;
  }

  async remove(id: string) {
    const removed = await this.promos.findByIdAndDelete(id).lean().exec();
    if (!removed) throw new NotFoundException('Promo code not found');
    return { deleted: true };
  }

  private assertRules(rules: {
    type: 'percent' | 'fixed';
    value: number;
    validFrom?: Date | null;
    validTo?: Date | null;
  }) {
    if (rules.type === 'percent' && (rules.value < 1 || rules.value > 100)) {
      throw appError(400, 'INVALID_PROMO_RULES', 'A percent promo must be between 1 and 100');
    }
    if (rules.validFrom && rules.validTo && rules.validFrom >= rules.validTo) {
      throw appError(400, 'INVALID_PROMO_RULES', 'validTo must be after validFrom');
    }
  }
}
