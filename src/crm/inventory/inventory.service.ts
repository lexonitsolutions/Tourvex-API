import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpsertInventoryDto } from './dto/upsert-inventory.dto';
import { Inventory } from './schemas/inventory.schema';

@Injectable()
export class InventoryService {
  constructor(@InjectModel(Inventory.name) private readonly inventory: Model<Inventory>) {}

  list() {
    return this.inventory.find().sort({ serviceDate: 1, title: 1 }).lean().exec();
  }

  async upsert(dto: UpsertInventoryDto) {
    const existing = await this.inventory.findOne({ sku: dto.sku });
    const committed = (existing?.reserved ?? 0) + (existing?.sold ?? 0);
    if (dto.capacity < committed) {
      throw new BadRequestException('Capacity cannot be lower than already reserved and sold stock');
    }
    return this.inventory.findOneAndUpdate(
      { sku: dto.sku },
      {
        $set: {
          ...dto,
          currency: dto.currency.toUpperCase(),
          serviceDate: dto.serviceDate ? new Date(dto.serviceDate) : undefined,
          available: dto.capacity - committed,
          active: true,
        },
        $setOnInsert: { reserved: 0, sold: 0 },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }

  async reserve(sku: string, quantity: number) {
    const item = await this.inventory.findOneAndUpdate(
      { sku, active: true, available: { $gte: quantity } },
      { $inc: { available: -quantity, reserved: quantity } },
      { returnDocument: 'after' },
    );
    if (!item) throw new BadRequestException('Insufficient inventory');
    return item;
  }

  async confirm(sku: string, quantity: number) {
    const item = await this.inventory.findOneAndUpdate(
      { sku, reserved: { $gte: quantity } },
      { $inc: { reserved: -quantity, sold: quantity } },
      { returnDocument: 'after' },
    );
    if (!item) throw new BadRequestException('Reserved stock is unavailable');
    return item;
  }

  async release(sku: string, quantity: number) {
    const item = await this.inventory.findOneAndUpdate(
      { sku, reserved: { $gte: quantity } },
      { $inc: { reserved: -quantity, available: quantity } },
      { returnDocument: 'after' },
    );
    if (!item) throw new BadRequestException('Reserved stock is unavailable');
    return item;
  }

  /** Puts sold stock back on sale (a confirmed booking was cancelled). */
  async restock(sku: string, quantity: number) {
    await this.inventory.findOneAndUpdate(
      { sku, sold: { $gte: quantity } },
      { $inc: { sold: -quantity, available: quantity } },
    );
  }

  async findBySku(sku: string) {
    const item = await this.inventory.findOne({ sku, active: true }).lean().exec();
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }
}
