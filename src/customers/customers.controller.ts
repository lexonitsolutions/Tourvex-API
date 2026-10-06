import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequirePermission } from '../admin/require-permission.decorator';
import { Audited, AuditInterceptor, setAuditContext } from '../audit/audited';
import { type CsvColumn, streamCsv } from '../common/csv/csv';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AddNoteDto } from '../common/notes/notes';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { type CustomerResult, CustomersService, type CustomerView } from './customers.service';
import {
  DeactivateCustomerDto,
  ListCustomersDto,
  ListPartnersDto,
  ReviewPartnerDto,
  UpdateCustomerDto,
  UpdatePartnerDto,
} from './dto/customers.dto';
import { type PartnerResult, PartnersAdminService, type PartnerView } from './partners-admin.service';

const CUSTOMER_COLUMNS: CsvColumn<CustomerView>[] = [
  { header: 'Name', value: (c) => c.name },
  { header: 'Email', value: (c) => c.email },
  { header: 'Joined', value: (c) => c.createdAt },
  { header: 'Active', value: (c) => c.active },
  { header: 'B2B', value: (c) => c.isB2B },
  { header: 'Marketing opt-out', value: (c) => c.marketingOptOut },
  { header: 'Tags', value: (c) => c.tags.join('; ') },
  { header: 'Bookings', value: (c) => c.stats.bookings },
  { header: 'Confirmed bookings', value: (c) => c.stats.confirmed },
  { header: 'Lifetime value AED', value: (c) => c.stats.lifetimeValueAed },
  { header: 'Last booking', value: (c) => c.stats.lastBookingAt },
];

const PARTNER_COLUMNS: CsvColumn<PartnerView>[] = [
  { header: 'Company', value: (p) => p.company },
  { header: 'Contact', value: (p) => p.name },
  { header: 'Email', value: (p) => p.email },
  { header: 'Phone', value: (p) => p.phone },
  { header: 'Application', value: (p) => p.applicationStatus },
  { header: 'Submitted', value: (p) => p.submittedAt },
  { header: 'Reviewed', value: (p) => p.reviewedAt },
  { header: 'B2B role', value: (p) => p.b2bRole },
  { header: 'Discount %', value: (p) => p.profile?.discountPercent },
  { header: 'Credit terms (days)', value: (p) => p.profile?.creditTermsDays },
  { header: 'Credit limit AED', value: (p) => p.profile?.creditLimitAed },
];

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/customers')
@UseInterceptors(AuditInterceptor)
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Customers (users that are not staff) with booking count and lifetime value (AED)' })
  list(@Query() query: ListCustomersDto) {
    return this.customers.list(query);
  }

  @Get('export.csv')
  @RequirePermission('customers.export')
  @Audited('customer', 'customer.export')
  async export(@Query() query: ListCustomersDto, @Req() request: Request, @Res() res: Response) {
    const result = await streamCsv(res, `customers-${new Date().toISOString().slice(0, 10)}.csv`, CUSTOMER_COLUMNS, this.customers.exportRows(query));
    setAuditContext(request, {
      entityId: 'export',
      summary: `Exported ${result.written} customers${result.truncated ? ' (capped)' : ''}`,
      changes: [{ field: 'filters', from: null, to: { ...query, page: undefined, limit: undefined } }],
    });
  }

  @Get(':id')
  @RequirePermission('customers.read')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id', ParseObjectIdPipe) id: string) {
    return this.customers.detail(id);
  }

  @Patch(':id')
  @RequirePermission('customers.write')
  @Header('Cache-Control', 'no-store')
  @Audited('customer', 'customer.update')
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCustomerDto, @Req() request: Request) {
    return this.respond(request, id, await this.customers.update(id, dto));
  }

  @Post(':id/notes')
  @RequirePermission('customers.write')
  @Header('Cache-Control', 'no-store')
  @Audited('customer', 'customer.note')
  async note(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.customers.addNote(id, dto.text, await this.customers.actorFor(user)));
  }

  @Post(':id/deactivate')
  @RequirePermission('customers.delete')
  @Header('Cache-Control', 'no-store')
  @Audited('customer', 'customer.deactivate')
  @ApiOperation({ summary: 'Deactivate the customer account (403 everywhere until reactivated)' })
  async deactivate(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DeactivateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.customers.setActive(id, false, dto, user.sub));
  }

  @Post(':id/reactivate')
  @RequirePermission('customers.delete')
  @Header('Cache-Control', 'no-store')
  @Audited('customer', 'customer.reactivate')
  async reactivate(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DeactivateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.customers.setActive(id, true, dto, user.sub));
  }

  private respond(request: Request, id: string, result: CustomerResult) {
    setAuditContext(request, { entityId: id, summary: result.summary, changes: result.changes });
    return result.customer;
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/partners')
@UseInterceptors(AuditInterceptor)
export class AdminPartnersController {
  constructor(private readonly partners: PartnersAdminService) {}

  @Get()
  @RequirePermission('partners.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'B2B partners and partner applications (status filter pending|approved|rejected)' })
  list(@Query() query: ListPartnersDto) {
    return this.partners.list(query);
  }

  @Get('counts')
  @RequirePermission('partners.read')
  @Header('Cache-Control', 'no-store')
  counts() {
    return this.partners.counts();
  }

  @Get('export.csv')
  @RequirePermission('partners.export')
  @Audited('partner', 'partner.export')
  async export(@Query() query: ListPartnersDto, @Req() request: Request, @Res() res: Response) {
    const result = await streamCsv(res, `partners-${new Date().toISOString().slice(0, 10)}.csv`, PARTNER_COLUMNS, this.partners.exportRows(query));
    setAuditContext(request, { entityId: 'export', summary: `Exported ${result.written} partners${result.truncated ? ' (capped)' : ''}` });
  }

  @Get(':id')
  @RequirePermission('partners.read')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id', ParseObjectIdPipe) id: string) {
    return this.partners.detail(id);
  }

  @Post(':id/review')
  @RequirePermission('partners.write')
  @Header('Cache-Control', 'no-store')
  @Audited('partner', 'partner.review')
  @ApiOperation({ summary: 'Approve (role + discount % + credit terms) or reject (reason required) an application' })
  async review(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReviewPartnerDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.partners.review(id, dto, user.sub));
  }

  @Patch(':id')
  @RequirePermission('partners.write')
  @Header('Cache-Control', 'no-store')
  @Audited('partner', 'partner.update')
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePartnerDto, @Req() request: Request) {
    return this.respond(request, id, await this.partners.update(id, dto));
  }

  private respond(request: Request, id: string, result: PartnerResult) {
    setAuditContext(request, { entityId: id, summary: result.summary, changes: result.changes });
    return result.partner;
  }
}
