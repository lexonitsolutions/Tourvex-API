import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WishlistItem, WishlistItemSchema } from './schemas/wishlist-item.schema';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: WishlistItem.name, schema: WishlistItemSchema }])],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
