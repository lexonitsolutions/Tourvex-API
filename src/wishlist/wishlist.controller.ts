import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { WishlistItemDto } from './dto/wishlist.dto';
import { WishlistService } from './wishlist.service';
import { WISHLIST_PRODUCT_TYPES, WishlistProductType } from './schemas/wishlist-item.schema';

const WishlistType = Object.fromEntries(WISHLIST_PRODUCT_TYPES.map((value) => [value, value]));

@ApiTags('wishlist')
@ApiBearerAuth()
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.wishlist.list(user.sub); }

  @Post('items')
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: WishlistItemDto) {
    return this.wishlist.add(user.sub, dto);
  }

  @Delete('items/:type/:slug')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('type', new ParseEnumPipe(WishlistType)) type: WishlistProductType, @Param('slug') slug: string) {
    return this.wishlist.remove(user.sub, type, slug);
  }
}
