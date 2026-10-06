import { Controller, Get, Header, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { permissionsForRoles } from '../admin/permissions';
import { RequirePermission } from '../admin/require-permission.decorator';
import { Audited, AuditInterceptor, setAuditContext } from '../audit/audited';
import { streamCsv, type CsvColumn } from '../common/csv/csv';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminReportsService } from './admin-reports.service';
import { ReportRangeDto } from './admin-reports.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseInterceptors(AuditInterceptor)
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  private async csv<T>(res: Response, request: Request, name: string, range: { from: string; to: string }, columns: CsvColumn<T>[], rows: T[]) {
    const result = await streamCsv(res, `${name}-${range.from}_${range.to}.csv`, columns, rows);
    setAuditContext(request, { entityId: name, summary: `Exported report ${name} ${range.from} to ${range.to} (${result.written} rows)` });
  }

  @Get('dashboard')
  @RequirePermission('dashboard.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Dashboard: KPIs with previous-period comparison and daily series, intelligence metrics, breakdowns, activity and rule-based insights. Sections the role cannot read are omitted.' })
  dashboard(@Query() query: ReportRangeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.dashboard(query, permissionsForRoles(user.roles));
  }

  @Get('reports/sales')
  @RequirePermission('dashboard.read', 'finance.read')
  @Header('Cache-Control', 'no-store')
  sales(@Query() query: ReportRangeDto) {
    return this.reports.salesReport(query);
  }

  @Get('reports/sales/export.csv')
  @RequirePermission('dashboard.read', 'finance.read', 'finance.export')
  @Audited('report', 'report.export')
  async salesCsv(@Query() query: ReportRangeDto, @Res() res: Response, @Req() req: Request) {
    const r = await this.reports.salesReport(query);
    await this.csv(res, req, 'sales-by-day-and-service', r.range, [
      { header: 'Date (Asia/Dubai)', value: (x: (typeof r.rows)[number]) => x.date },
      { header: 'Service type', value: (x) => x.serviceType },
      { header: 'Confirmed bookings', value: (x) => x.bookings },
      { header: 'Revenue AED', value: (x) => x.revenue },
    ], r.rows);
  }

  @Get('reports/top-activities')
  @RequirePermission('dashboard.read', 'finance.read')
  @Header('Cache-Control', 'no-store')
  topActivities(@Query() query: ReportRangeDto) {
    return this.reports.topActivitiesReport(query);
  }

  @Get('reports/top-activities/export.csv')
  @RequirePermission('dashboard.read', 'finance.read', 'finance.export')
  @Audited('report', 'report.export')
  async topCsv(@Query() query: ReportRangeDto, @Res() res: Response, @Req() req: Request) {
    const r = await this.reports.topActivitiesReport(query);
    await this.csv(res, req, 'top-activities', r.range, [
      { header: 'Rank', value: (x: (typeof r.rows)[number]) => x.rank },
      { header: 'Activity', value: (x) => x.title },
      { header: 'Service type', value: (x) => x.serviceType },
      { header: 'Bookings', value: (x) => x.bookings },
      { header: 'Travellers', value: (x) => x.travellers },
      { header: 'Revenue AED', value: (x) => x.revenue },
      { header: 'Average value AED', value: (x) => x.averageValue },
    ], r.rows);
  }

  @Get('reports/lead-funnel')
  @RequirePermission('dashboard.read', 'enquiries.read')
  @Header('Cache-Control', 'no-store')
  leadFunnel(@Query() query: ReportRangeDto) {
    return this.reports.leadFunnelReport(query);
  }

  @Get('reports/lead-funnel/export.csv')
  @RequirePermission('dashboard.read', 'enquiries.read', 'enquiries.export')
  @Audited('report', 'report.export')
  async funnelCsv(@Query() query: ReportRangeDto, @Res() res: Response, @Req() req: Request) {
    const r = await this.reports.leadFunnelReport(query);
    await this.csv(res, req, 'lead-funnel-and-sources', r.range, [
      { header: 'Source', value: (x: (typeof r.sources)[number]) => x.source },
      { header: 'Leads', value: (x) => x.leads },
      { header: 'Won', value: (x) => x.won },
      { header: 'Lost', value: (x) => x.lost },
      { header: 'Conversion %', value: (x) => x.conversionRate },
    ], r.sources);
  }

  @Get('reports/support')
  @RequirePermission('dashboard.read', 'tickets.read')
  @Header('Cache-Control', 'no-store')
  support(@Query() query: ReportRangeDto) {
    return this.reports.supportSlaReport(query);
  }

  @Get('reports/support/export.csv')
  @RequirePermission('dashboard.read', 'tickets.read', 'tickets.export')
  @Audited('report', 'report.export')
  async supportCsv(@Query() query: ReportRangeDto, @Res() res: Response, @Req() req: Request) {
    const r = await this.reports.supportSlaReport(query);
    await this.csv(res, req, 'support-sla', r.range, [
      { header: 'Date (Asia/Dubai)', value: (x: (typeof r.byDay)[number]) => x.date },
      { header: 'Tickets created', value: (x) => x.created },
      { header: 'Resolved or closed', value: (x) => x.resolved },
    ], r.byDay);
  }

  @Get('reports/cancellations')
  @RequirePermission('dashboard.read', 'bookings.read', 'finance.read')
  @Header('Cache-Control', 'no-store')
  cancellations(@Query() query: ReportRangeDto) {
    return this.reports.cancellationsReport(query);
  }

  @Get('reports/cancellations/export.csv')
  @RequirePermission('dashboard.read', 'bookings.read', 'finance.read', 'finance.export')
  @Audited('report', 'report.export')
  async cancellationsCsv(@Query() query: ReportRangeDto, @Res() res: Response, @Req() req: Request) {
    const r = await this.reports.cancellationsReport(query);
    await this.csv(res, req, 'cancellations-and-refunds', r.range, [
      { header: 'Date (Asia/Dubai)', value: (x: (typeof r.byDay)[number]) => x.date },
      { header: 'Bookings cancelled or refunded (created that day)', value: (x) => x.cancelled },
      { header: 'Refunds', value: (x) => x.refunds },
      { header: 'Refunded AED', value: (x) => x.refundedAmount },
    ], r.byDay);
  }
}
