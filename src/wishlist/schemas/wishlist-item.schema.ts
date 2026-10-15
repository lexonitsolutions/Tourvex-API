import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const WISHLIST_PRODUCT_TYPES = ['activity', 'visa', 'yacht', 'holiday', 'cruise'] as const;
export type WishlistProductType = (typeof WISHLIST_PRODUCT_TYPES)[number];
export type WishlistItemDocument = HydratedDocument<WishlistItem>;

@Schema({ timestamps: true, collection: 'user_wishlist' })
export class WishlistItem {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: WISHLIST_PRODUCT_TYPES })
  productType: WishlistProductType;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  productSlug: string;

  createdAt: Date;
  updatedAt: Date;
}

export const WishlistItemSchema = SchemaFactory.createForClass(WishlistItem);
WishlistItemSchema.index(
  { userId: 1, productType: 1, productSlug: 1 },
  { unique: true, name: 'user_product_unique' },
);
WishlistItemSchema.index({ userId: 1, createdAt: -1 });
