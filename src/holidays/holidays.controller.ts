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
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { CreateHolidayEnquiryDto } from './dto/create-enquiry.dto';
import { ListHolidaysDto } from './dto/list-holidays.dto';
import { ListHolidayEnquiriesDto, UpdateHolidayEnquiryStatusDto } from './dto/update-enquiry-status.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { HolidaysService } from './holidays.service';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

@ApiTags('holidays')
@Controller('holidays')
export class HolidaysController {
  constructor(
    private readonly holidays: HolidaysService,
    private readonly optionalUser: OptionalUserResolver,
    private readonly audit: AuditService,
  ) {}

  // Static routes must stay above ':slug'.

  @Public()
  @Get('home')
  @ApiOperation({ summary: 'Holidays landing page data: banners, cities, countries, collections' })
  home() {
    return this.holidays.home();
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/all')
  @ApiOperation({ summary: 'List every package including unpublished and sample ones' })
  listAll(@Query() query: ListHolidaysDto) {
    return this.holidays.list(query, true);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/:id')
  @ApiOperation({ summary: 'Full stored holiday record for editing, including unpublished ones' })
  getAdmin(@Param('id', ParseObjectIdPipe) id: string) {
    return this.holidays.getAdmin(id);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Get('enquiries/admin')
  @ApiOperation({ summary: 'List holiday booking enquiries, newest first' })
  listEnquiries(@Query() query: ListHolidayEnquiriesDto) {
    return this.holidays.listEnquiries(query);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch('enquiries/:id')
  @ApiOperation({ summary: 'Update an enquiry status and optional internal note' })
  updateEnquiry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHolidayEnquiryStatusDto,
  ) {
    return this.holidays.updateEnquiry(id, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search and filter holiday packages' })
  list(@Query() query: ListHolidaysDto) {
    return this.holidays.list(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Holiday package detail with related packages' })
  findOne(@Param('slug') slug: string, @Query('currency') currency?: string) {
    return this.holidays.findBySlug(slug, currency?.toUpperCase().slice(0, 3) || undefined);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':slug/enquiries')
  @ApiOperation({ summary: 'Submit an instant holiday booking enquiry' })
  async createEnquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateHolidayEnquiryDto,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.optionalUser.resolveUserId(authorization);
    return this.holidays.createEnquiry(slug, dto, userId);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Post()
  async create(
    @Body() dto: CreateHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const created = await this.holidays.create(dto);
    await recordCatalogAudit(this.audit, user, request, 'holiday', planCreateAudit('holiday', created, dto));
    return created;
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const before = await this.holidays.getAdmin(id);
    const updated = await this.holidays.update(id, dto);
    for (const entry of planUpdateAudit('holiday', before, dto)) {
      await recordCatalogAudit(this.audit, user, request, 'holiday', entry);
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
    const before = await this.holidays.getAdmin(id);
    const result = await this.holidays.remove(id);
    await recordCatalogAudit(this.audit, user, request, 'holiday', planDeleteAudit('holiday', before));
    return result;
  }
}
