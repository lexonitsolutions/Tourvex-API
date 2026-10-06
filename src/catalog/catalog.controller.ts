import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { CatalogService } from './catalog.service';
import { AvailabilityQueryDto, QuoteDto, QuoteQueryDto } from './dto/activity-booking.dto';
import { ListActivitiesDto } from './dto/list-activities.dto';
import { UpdateActivityDetailsDto } from './dto/update-activity-details.dto';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('activities')
  @ApiOperation({ summary: 'List migrated activities with filters and pagination' })
  listActivities(@Query() query: ListActivitiesDto) {
    return this.catalog.listActivities(query);
  }

  @Public()
  @Get('activities/:slug')
  @ApiOperation({ summary: 'Activity detail with options and rating summary (when real data exists)' })
  findActivity(@Param('slug') slug: string, @Query('locale') locale = 'en') {
    return this.catalog.findBySlug(slug, locale);
  }

  @Public()
  @Get('activities/:slug/availability')
  @ApiOperation({ summary: 'Per-day availability of one option for a month' })
  availability(@Param('slug') slug: string, @Query() query: AvailabilityQueryDto) {
    return this.catalog.availability(slug, query);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('activities/:slug/quote')
  @ApiOperation({ summary: 'Server-side price quote (30 per minute per IP); takes no hold' })
  quote(@Param('slug') slug: string, @Body() dto: QuoteDto, @Query() query: QuoteQueryDto) {
    return this.catalog.quote(slug, dto, query.currency);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch('activities/:id/details')
  @ApiOperation({ summary: 'Edit the detail block and options of an activity' })
  updateDetails(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateActivityDetailsDto) {
    return this.catalog.updateDetails(id, dto);
  }
}
