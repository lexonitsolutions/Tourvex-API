import { IsIn, IsString, Matches } from 'class-validator';
import { WISHLIST_PRODUCT_TYPES, WishlistProductType } from '../schemas/wishlist-item.schema';

export class WishlistItemDto {
  @IsIn(WISHLIST_PRODUCT_TYPES)
  productType: WishlistProductType;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,199}$/, { message: 'productSlug is invalid' })
  productSlug: string;
}
