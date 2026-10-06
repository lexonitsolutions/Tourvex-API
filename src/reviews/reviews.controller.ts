import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import {
  CreateReviewDto,
  ListReviewsAdminDto,
  ListReviewsDto,
  ModerateReviewDto,
} from './dto/reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('catalog')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // Static `reviews/admin` stays above the `reviews/:id` PATCH (different method, but keep it explicit).

  @Roles(Role.Admin, Role.SuperAdmin, Role.Support, Role.Content)
  @ApiBearerAuth()
  @Get('reviews/admin')
  @ApiOperation({ summary: 'Moderation queue (default status=pending)' })
  listForStaff(@Query() query: ListReviewsAdminDto) {
    return this.reviews.listForStaff(query);
  }

  @Roles(Role.Admin, Role.SuperAdmin, Role.Support, Role.Content)
  @ApiBearerAuth()
  @Patch('reviews/:id')
  @ApiOperation({ summary: 'Publish or reject a review' })
  moderate(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ModerateReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.moderate(id, dto, user.sub);
  }

  @Public()
  @Get('activities/:slug/reviews')
  @ApiOperation({ summary: 'Published reviews with the computed rating summary' })
  list(@Param('slug') slug: string, @Query() query: ListReviewsDto) {
    return this.reviews.list(slug, query);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('activities/:slug/reviews')
  @ApiOperation({ summary: 'Review an activity after a confirmed, completed booking (created pending)' })
  create(
    @Param('slug') slug: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.create(slug, dto, user);
  }
}
