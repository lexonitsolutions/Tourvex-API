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
import { CreateVisaEnquiryDto } from './dto/create-enquiry.dto';
import { CreateVisaDto } from './dto/create-visa.dto';
import { ListVisasDto } from './dto/list-visas.dto';
import { ListVisaEnquiriesDto, UpdateVisaEnquiryStatusDto } from './dto/update-enquiry-status.dto';
import { UpdateVisaDto } from './dto/update-visa.dto';
import { VisasService } from './visas.service';

@ApiTags('visas')
@Controller('visas')
export class VisasController {
  constructor(
    private readonly visas: VisasService,
    private readonly optionalUser: OptionalUserResolver,
    private readonly audit: AuditService,
  ) {}

  // Static routes must stay above ':slug'.

  @Public()
  @Get('home')
  @ApiOperation({ summary: 'Visas landing page data: banners and sections of country visa cards' })
  home() {
    return this.visas.home();
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/all')
  @ApiOperation({ summary: 'List every visa including unpublished and sample ones' })
  listAll(@Query() query: ListVisasDto) {
    return this.visas.list(query, true);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.read')
  @Header('Cache-Control', 'no-store')
  @Get('admin/:id')
  @ApiOperation({ summary: 'Full stored visa record for editing, including unpublished ones' })
  getAdmin(@Param('id', ParseObjectIdPipe) id: string) {
    return this.visas.getAdmin(id);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Get('enquiries/admin')
  @ApiOperation({ summary: 'List visa enquiries, newest first' })
  listEnquiries(@Query() query: ListVisaEnquiriesDto) {
    return this.visas.listEnquiries(query);
  }

  @Roles(Role.Sales, Role.Support, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch('enquiries/:id')
  @ApiOperation({ summary: 'Update an enquiry status and optional internal note' })
  updateEnquiry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateVisaEnquiryStatusDto,
  ) {
    return this.visas.updateEnquiry(id, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search and filter visas' })
  list(@Query() query: ListVisasDto) {
    return this.visas.list(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Visa detail with related visas' })
  findOne(@Param('slug') slug: string, @Query('currency') currency?: string) {
    return this.visas.findBySlug(slug, currency?.toUpperCase().slice(0, 3) || undefined);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':slug/enquiries')
  @ApiOperation({
    summary: 'Submit a visa enquiry (public, 5 per minute per IP)',
    description:
      'Optionally send a Clerk bearer token to link the enquiry to your account; an invalid token is ignored.',
  })
  async createEnquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateVisaEnquiryDto,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.optionalUser.resolveUserId(authorization);
    return this.visas.createEnquiry(slug, dto, userId);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Post()
  async create(
    @Body() dto: CreateVisaDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const created = await this.visas.create(dto);
    await recordCatalogAudit(this.audit, user, request, 'visa', planCreateAudit('visa', created, dto));
    return created;
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @RequirePermission('catalog.write')
  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateVisaDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const before = await this.visas.getAdmin(id);
    const updated = await this.visas.update(id, dto);
    for (const entry of planUpdateAudit('visa', before, dto)) {
      await recordCatalogAudit(this.audit, user, request, 'visa', entry);
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
    const before = await this.visas.getAdmin(id);
    const result = await this.visas.remove(id);
    await recordCatalogAudit(this.audit, user, request, 'visa', planDeleteAudit('visa', before));
    return result;
  }
}
