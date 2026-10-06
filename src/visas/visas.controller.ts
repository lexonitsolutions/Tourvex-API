import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalUserResolver } from '../auth/optional-user.resolver';
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
  @Get('admin/all')
  @ApiOperation({ summary: 'List every visa including unpublished and sample ones' })
  listAll(@Query() query: ListVisasDto) {
    return this.visas.list(query, true);
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
  @Post()
  create(@Body() dto: CreateVisaDto) {
    return this.visas.create(dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateVisaDto) {
    return this.visas.update(id, dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Delete(':id')
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.visas.remove(id);
  }
}
