import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalUserResolver } from '../auth/optional-user.resolver';
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
    private readonly optionalUser: OptionalUserResolver,
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
  @Get('admin/all')
  @ApiOperation({ summary: 'List every cruise including unpublished, sample and departure-less ones' })
  listAll(@Query() query: ListCruisesDto) {
    return this.cruises.list(query, true);
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

  @Public()
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
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.optionalUser.resolveUserId(authorization);
    return this.cruises.createEnquiry(slug, dto, userId);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Post()
  create(@Body() dto: CreateCruiseDto) {
    return this.cruises.create(dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Patch(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCruiseDto) {
    return this.cruises.update(id, dto);
  }

  @Roles(Role.Content, Role.Admin, Role.SuperAdmin)
  @ApiBearerAuth()
  @Delete(':id')
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.cruises.remove(id);
  }
}
