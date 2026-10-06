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
import {
  AssignLeadDto,
  BulkAssignDto,
  BulkStatusDto,
  ChangeLeadStatusDto,
  FollowUpDto,
  ListLeadsDto,
  LogContactDto,
  UpdateLeadDto,
} from './dto/leads.dto';
import { type LeadResult, LeadsService, type LeadView } from './leads.service';

const CSV_COLUMNS: CsvColumn<LeadView>[] = [
  { header: 'Reference', value: (l) => l.reference },
  { header: 'Created', value: (l) => l.createdAt },
  { header: 'Source', value: (l) => l.source },
  { header: 'Source reference', value: (l) => l.sourceRef },
  { header: 'Item', value: (l) => l.catalog?.title ?? l.catalog?.slug },
  { header: 'Name', value: (l) => l.name },
  { header: 'Email', value: (l) => l.email },
  { header: 'Phone', value: (l) => l.phone },
  { header: 'Nationality', value: (l) => l.nationality },
  { header: 'Travellers', value: (l) => l.pax },
  { header: 'Travel date', value: (l) => l.travelDate },
  { header: 'Value AED', value: (l) => l.valueAed },
  { header: 'Status', value: (l) => l.status },
  { header: 'Lost reason', value: (l) => l.lostReason },
  { header: 'Priority', value: (l) => l.priority },
  { header: 'Owner', value: (l) => l.owner?.name },
  { header: 'Next follow-up', value: (l) => l.nextFollowUpAt },
  { header: 'Tags', value: (l) => l.tags.join('; ') },
  { header: 'Marketing opt-out', value: (l) => l.marketingOptOut },
];

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/leads')
@UseInterceptors(AuditInterceptor)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission('enquiries.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List leads (filters: source, status, owner, priority, followUp, tag, dates, q)' })
  list(@Query() query: ListLeadsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.list(query, user.sub);
  }

  @Get('pipeline')
  @RequirePermission('enquiries.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Kanban columns with counts, values and the newest cards per status' })
  pipeline(@Query() query: ListLeadsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.pipeline(query, user.sub);
  }

  @Get('stats')
  @RequirePermission('enquiries.read')
  @Header('Cache-Control', 'no-store')
  stats() {
    return this.leads.headline();
  }

  @Get('owners')
  @RequirePermission('enquiries.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Staff who can own leads (for the owner select)' })
  owners() {
    return this.leads.owners();
  }

  @Get('export.csv')
  @RequirePermission('enquiries.export')
  @Audited('lead', 'lead.export')
  @ApiOperation({ summary: 'CSV export of the filtered leads (max 10,000 rows)' })
  async export(
    @Query() query: ListLeadsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() res: Response,
  ) {
    const result = await streamCsv(
      res,
      `leads-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_COLUMNS,
      this.leads.exportRows(query, user.sub),
    );
    setAuditContext(request, {
      entityId: 'export',
      summary: `Exported ${result.written} leads${result.truncated ? ' (capped)' : ''}`,
      changes: [{ field: 'filters', from: null, to: { ...query, page: undefined, limit: undefined } }],
    });
  }

  @Post('bulk/assign')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.bulk_assign')
  async bulkAssign(@Body() dto: BulkAssignDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const result = await this.leads.bulkAssign(dto, await this.leads.actorFor(user));
    setAuditContext(request, {
      entityId: 'bulk',
      summary: `Bulk assigned ${result.updated} of ${result.requested} leads`,
      changes: [{ field: 'ownerId', from: null, to: dto.ownerId ?? null }, { field: 'ids', from: null, to: dto.ids }],
    });
    return result;
  }

  @Post('bulk/status')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.bulk_status')
  async bulkStatus(@Body() dto: BulkStatusDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const result = await this.leads.bulkStatus(dto, await this.leads.actorFor(user));
    setAuditContext(request, {
      entityId: 'bulk',
      summary: `Bulk set ${result.updated} of ${result.requested} leads to ${dto.status}`,
      changes: [{ field: 'status', from: null, to: dto.status }, { field: 'ids', from: null, to: dto.ids }],
    });
    return result;
  }

  @Get(':id')
  @RequirePermission('enquiries.read')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.leads.get(id);
  }

  @Patch(':id')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.update')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.leads.update(id, dto, await this.leads.actorFor(user)));
  }

  @Post(':id/assign')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.assign')
  async assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.leads.assign(id, dto, await this.leads.actorFor(user)));
  }

  @Post(':id/status')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.status')
  async status(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeLeadStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.leads.changeStatus(id, dto, await this.leads.actorFor(user)));
  }

  @Post(':id/follow-up')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.follow_up')
  async followUp(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FollowUpDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.leads.setFollowUp(id, dto, await this.leads.actorFor(user)));
  }

  @Post(':id/notes')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.note')
  async note(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.leads.addNote(id, dto.text, await this.leads.actorFor(user)));
  }

  @Post(':id/contact')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @Audited('lead', 'lead.contact')
  @ApiOperation({ summary: 'Log that a staff member contacted the lead (email, phone or WhatsApp)' })
  async contact(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: LogContactDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.leads.logContact(id, dto, await this.leads.actorFor(user)));
  }

  private respond(request: Request, id: string, result: LeadResult) {
    setAuditContext(request, { entityId: id, summary: result.summary, changes: result.changes });
    return result.lead;
  }
}
