import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalUserResolver } from '../auth/optional-user.resolver';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { CreateEventEnquiryDto } from './dto/create-enquiry.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsDto } from './dto/list-events.dto';
import {
  ListEventEnquiriesDto,
  UpdateEventEnquiryStatusDto,
} from './dto/update-enquiry-status.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly optionalUser: OptionalUserResolver,
  ) {}

  // Static routes must stay above ':slug'.

  @Public()
  @Get('home')
  @ApiOperation({ summary: 'Events landing page: banners, categories, cities and sections' })
  home() {
    return this.events.home();
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Get('admin/all')
  @ApiOperation({ summary: 'List every event including unpublished, sample and session-less ones' })
  listAll(@Query() query: ListEventsDto) {
    return this.events.list(query, true);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Get('enquiries/admin')
  @ApiOperation({ summary: 'List event enquiries, newest first' })
  listEnquiries(@Query() query: ListEventEnquiriesDto) {
    return this.events.listEnquiries(query);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch('enquiries/:id')
  @ApiOperation({ summary: 'Update an enquiry status and optional internal note' })
  updateEnquiry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateEventEnquiryStatusDto,
  ) {
    return this.events.updateEnquiry(id, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search and filter events (only upcoming sessions are considered)' })
  list(@Query() query: ListEventsDto) {
    return this.events.list(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Event detail with upcoming sessions and related events' })
  findOne(@Param('slug') slug: string, @Query('currency') currency?: string) {
    return this.events.findBySlug(slug, currency?.toUpperCase().slice(0, 3) || undefined);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':slug/enquiries')
  @ApiOperation({
    summary: 'Submit a ticket enquiry (public, 5 per minute per IP)',
    description:
      'Optionally send a Clerk bearer token to link the enquiry to your account; an invalid token is ignored.',
  })
  async createEnquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateEventEnquiryDto,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.optionalUser.resolveUserId(authorization);
    return this.events.createEnquiry(slug, dto, userId);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Post()
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Delete(':id')
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.events.remove(id);
  }
}
