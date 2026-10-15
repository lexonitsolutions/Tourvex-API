import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { appError } from '../common/app-error';
import { WishlistItemDto } from './dto/wishlist.dto';
import { WishlistItem, WishlistProductType } from './schemas/wishlist-item.schema';

const COLLECTIONS = {
  activity: 'activities', visa: 'visas', yacht: 'activities', holiday: 'holidays', cruise: 'cruises',
} as const;

@Injectable()
export class WishlistService {
  constructor(
    @InjectModel(WishlistItem.name) private readonly items: Model<WishlistItem>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async list(userId: string) {
    const saved = await this.items.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).lean().exec();
    const hydrated = await Promise.all(saved.map(async (item) => {
      const product = await this.connection.db!.collection(COLLECTIONS[item.productType]).findOne(
        { slug: item.productSlug },
        { projection: { slug: 1, title: 1, coverImage: 1, imageUrl: 1, images: 1, price: 1, salePrice: 1, published: 1, allowAddToCart: 1, stockStatus: 1 } },
      );
      const title = typeof product?.title === 'string' ? product.title : product?.title?.en;
      return {
        id: String(item._id), productType: item.productType, productSlug: item.productSlug,
        createdAt: item.createdAt,
        available: Boolean(product?.published),
        product: product ? {
          slug: product.slug, title: title || item.productSlug,
          image: product.coverImage || product.imageUrl || product.images?.[0]?.url || '',
          price: product.salePrice || product.price || null,
          allowAddToCart: ['activity', 'visa', 'yacht'].includes(item.productType) && Boolean(product.allowAddToCart),
          soldOut: Boolean(product.stockStatus?.soldOut),
        } : null,
      };
    }));
    return { items: hydrated, count: hydrated.length };
  }

  async add(userId: string, dto: WishlistItemDto) {
    const product = await this.connection.db!.collection(COLLECTIONS[dto.productType]).findOne(
      { slug: dto.productSlug, published: true }, { projection: { _id: 1 } },
    );
    if (!product) throw appError(404, 'PACKAGE_NOT_FOUND', 'This package is not available');
    await this.items.updateOne(
      { userId: new Types.ObjectId(userId), productType: dto.productType, productSlug: dto.productSlug },
      { $setOnInsert: { userId: new Types.ObjectId(userId), productType: dto.productType, productSlug: dto.productSlug } },
      { upsert: true },
    ).exec();
    return this.list(userId);
  }

  async remove(userId: string, type: WishlistProductType, slug: string) {
    await this.items.deleteOne({ userId: new Types.ObjectId(userId), productType: type, productSlug: slug }).exec();
    return this.list(userId);
  }
}
