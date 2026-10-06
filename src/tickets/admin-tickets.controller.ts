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
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import {
  AssignTicketDto,
  BulkCloseTicketsDto,
  ChangeTicketStatusDto,
  ListTicketsDto,
  StaffReplyDto,
  UpdateTicketDto,
} from './dto/tickets.dto';
import { type TicketResult, TicketsService, type TicketView } from './tickets.service';

const CSV_COLUMNS: CsvColumn<TicketView>[] = [
  { header: 'Number', value: (t) => t.number },
  { header: 'Created', value: (t) => t.createdAt },
  { header: 'Subject', value: (t) => t.subject },
  { header: 'Category', value: (t) => t.category },
  { header: 'Priority', value: (t) => t.priority },
  { header: 'Status', value: (t) => t.status },
  { header: 'Requester', value: (t) => t.requester.name },
  { header: 'Requester email', value: (t) => t.requester.email },
  { header: 'Booking', value: (t) => t.booking?.reference },
  { header: 'Assignee', value: (t) => t.assignee?.name },
  { header: 'First response', value: (t) => t.firstResponseAt },
  { header: 'Resolved', value: (t) => t.resolvedAt },
  { header: 'First response SLA', value: (t) => t.sla?.firstResponse },
  { header: 'Resolution SLA', value: (t) => t.sla?.resolution },
  { header: 'SLA breached', value: (t) => t.sla?.breached },
];

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/tickets')
@UseInterceptors(AuditInterceptor)
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @RequirePermission('tickets.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Ticket queue (tab: mine|unassigned|all|overdue) with SLA flags' })
  list(@Query() query: ListTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.list(query, user.sub);
  }

  @Get('counts')
  @RequirePermission('tickets.read')
  @Header('Cache-Control', 'no-store')
  counts(@CurrentUser() user: AuthenticatedUser) {
    return this.tickets.counts(user.sub);
  }

  @Get('assignees')
  @RequirePermission('tickets.read')
  @Header('Cache-Control', 'no-store')
  assignees() {
    return this.tickets.assignees();
  }

  @Get('export.csv')
  @RequirePermission('tickets.export')
  @Audited('ticket', 'ticket.export')
  async export(
    @Query() query: ListTicketsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() res: Response,
  ) {
    const result = await streamCsv(
      res,
      `tickets-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_COLUMNS,
      this.tickets.exportRows(query, user.sub),
    );
    setAuditContext(request, {
      entityId: 'export',
      summary: `Exported ${result.written} tickets${result.truncated ? ' (capped)' : ''}`,
      changes: [{ field: 'filters', from: null, to: { ...query, page: undefined, limit: undefined } }],
    });
  }

  @Post('bulk/close')
  @RequirePermission('tickets.write')
  @Header('Cache-Control', 'no-store')
  @Audited('ticket', 'ticket.bulk_close')
  async bulkClose(@Body() dto: BulkCloseTicketsDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const result = await this.tickets.bulkClose(dto.ids, await this.tickets.actorFor(user));
    setAuditContext(request, {
      entityId: 'bulk',
      summary: `Bulk closed ${result.updated} of ${result.requested} tickets`,
      changes: [{ field: 'ids', from: null, to: dto.ids }],
    });
    return result;
  }

  @Get(':id')
  @RequirePermission('tickets.read')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.tickets.get(id);
  }

  @Post(':id/reply')
  @RequirePermission('tickets.write')
  @Header('Cache-Control', 'no-store')
  @Audited('ticket', 'ticket.reply')
  @ApiOperation({ summary: 'Public reply to the customer, or an internal note with internal=true' })
  async reply(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: StaffReplyDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.tickets.reply(id, dto, await this.tickets.actorFor(user));
    // The message body is never copied into the audit log.
    return this.respond(request, id, { ...result, changes: result.changes });
  }

  @Patch(':id')
  @RequirePermission('tickets.write')
  @Header('Cache-Control', 'no-store')
  @Audited('ticket', 'ticket.update')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.tickets.update(id, dto, await this.tickets.actorFor(user)));
  }

  @Post(':id/assign')
  @RequirePermission('tickets.write')
  @Header('Cache-Control', 'no-store')
  @Audited('ticket', 'ticket.assign')
  async assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.tickets.assign(id, dto, await this.tickets.actorFor(user)));
  }

  @Post(':id/status')
  @RequirePermission('tickets.write')
  @Header('Cache-Control', 'no-store')
  @Audited('ticket', 'ticket.status')
  async status(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeTicketStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.respond(request, id, await this.tickets.changeStatus(id, dto.status, await this.tickets.actorFor(user)));
  }

  private respond(request: Request, id: string, result: TicketResult) {
    setAuditContext(request, { entityId: id, summary: result.summary, changes: result.changes });
    return result.ticket;
  }
}
