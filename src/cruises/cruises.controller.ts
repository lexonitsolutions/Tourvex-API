import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../admin/require-permission.decorator';
import { AuditService } from '../audit/audit.service';
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
import { CruisesService } from './cruises.service';
import { CreateCruiseDto } from './dto/create-cruise.dto';
import { CreateCruiseEnquiryDto } from './dto/create-enquiry.dto';
import { ListCruisesDto } from './dto/list-cruises.dto';
import { UpdateCruiseDto } from './dto/update-cruise.dto';
import { ListCruiseEnquiriesDto, UpdateCruiseEnquiryStatusDto } from './dto/update-enquiry-status.dto';

@ApiTags('cruises')
@Controller('cruises')
export class CruisesController {
  constructor(
    private readonly cruises: CruisesService,
    private readonly audit: AuditService,
  ) {}

  // Static routes must stay above ':slug'.

  @Public()
  @Get('home')
  @ApiOperation({ summary: 'Cruises landing page: banners, departure cities, best-seller sections, lines' })
  home() {
    return this.cruises.home();
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/all')
  @ApiOperation({ summary: 'List every cruise including unpublished, sample and departure-less ones' })
  listAll(@Query() query: ListCruisesDto) {
    return this.cruises.list(query, true);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/:id')
  @ApiOperation({ summary: 'Full stored cruise record for editing, including unpublished ones' })
  getAdmin(@Param('id', ParseObjectIdPipe) id: string) {
    return this.cruises.getAdmin(id);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Get('enquiries/admin')
  @ApiOperation({ summary: 'List cruise enquiries, newest first' })
  listEnquiries(@Query() query: ListCruiseEnquiriesDto) {
    return this.cruises.listEnquiries(query);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch('enquiries/:id')
  @ApiOperation({ summary: 'Update an enquiry status and optional internal note' })
  updateEnquiry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCruiseEnquiryStatusDto,
  ) {
    return this.cruises.updateEnquiry(id, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search and filter cruises (only upcoming departures are returned)' })
  list(@Query() query: ListCruisesDto) {
    return this.cruises.list(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Cruise detail with upcoming departures and related cruises' })
  findOne(@Param('slug') slug: string, @Query('currency') currency?: string) {
    return this.cruises.findBySlug(slug, currency?.toUpperCase().slice(0, 3) || undefined);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':slug/enquiries')
  @ApiOperation({
    summary: 'Submit a cruise enquiry (public, 5 per minute per IP)',
    description:
      'Optionally send a Clerk bearer token to link the enquiry to your account; an invalid token is ignored.',
  })
  async createEnquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateCruiseEnquiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cruises.createEnquiry(slug, dto, user.sub);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Post()
  async create(
    @Body() dto: CreateCruiseDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const created = await this.cruises.create(dto);
    await recordCatalogAudit(this.audit, user, request, 'cruise', planCreateAudit('cruise', created, dto));
    return created;
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCruiseDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const before = await this.cruises.getAdmin(id);
    const updated = await this.cruises.update(id, dto);
    for (const entry of planUpdateAudit('cruise', before, dto)) {
      await recordCatalogAudit(this.audit, user, request, 'cruise', entry);
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
    const before = await this.cruises.getAdmin(id);
    const result = await this.cruises.remove(id);
    await recordCatalogAudit(this.audit, user, request, 'cruise', planDeleteAudit('cruise', before));
    return result;
  }
}
