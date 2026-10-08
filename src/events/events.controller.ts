import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../admin/require-permission.decorator';
import { AuditService } from '../audit/audit.service';
import { OptionalUserResolver } from '../auth/optional-user.resolver';
import {
  planCreateAudit,
  planDeleteAudit,
  planUpdateAudit,
  recordCatalogAudit,
} from '../common/catalog/admin-catalog';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
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
    private readonly audit: AuditService,
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
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/all')
  @ApiOperation({ summary: 'List every event including unpublished, sample and session-less ones' })
  listAll(@Query() query: ListEventsDto) {
    return this.events.list(query, true);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/:id')
  @ApiOperation({ summary: 'Full stored event record for editing, including unpublished ones' })
  getAdmin(@Param('id', ParseObjectIdPipe) id: string) {
    return this.events.getAdmin(id);
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
  @RequirePermission('catalog.write')
  @Post()
  async create(
    @Body() dto: CreateEventDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const created = await this.events.create(dto);
    await recordCatalogAudit(this.audit, user, request, 'event', planCreateAudit('event', created, dto));
    return created;
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const before = await this.events.getAdmin(id);
    const updated = await this.events.update(id, dto);
    for (const entry of planUpdateAudit('event', before, dto)) {
      await recordCatalogAudit(this.audit, user, request, 'event', entry);
    }
    return updated;
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.delete')
  @Delete(':id')
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const before = await this.events.getAdmin(id);
    const result = await this.events.remove(id);
    await recordCatalogAudit(this.audit, user, request, 'event', planDeleteAudit('event', before));
    return result;
  }
}
