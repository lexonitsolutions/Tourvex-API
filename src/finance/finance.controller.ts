import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { RequirePermission } from '../admin/require-permission.decorator';
import { Audited, AuditInterceptor, setAuditContext } from '../audit/audited';
import { appError } from '../common/app-error';
import { streamCsv } from '../common/csv/csv';
import { ListInvoicesDto } from '../crm/billing/billing.dto';
import { EmailInvoiceDto } from '../tax/tax.dto';
import { BillingService } from '../crm/billing/billing.service';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { FinanceRangeDto, GenerateInvoiceDto } from './finance.dto';
import { FinanceService } from './finance.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking } from '../bookings/schemas/booking.schema';
import { SettingsService } from '../admin/settings/settings.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/finance')
@UseInterceptors(AuditInterceptor)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('overview')
  @RequirePermission('finance.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Collected, refunded, net, by day and service type, outstanding pending payments (AED)' })
  overview(@Query() query: FinanceRangeDto) {
    return this.finance.overview(query);
  }

  @Get('reconciliation')
  @RequirePermission('finance.reconcile')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Daily payments vs refunds vs paid orders, with variance' })
  reconciliation(@Query() query: FinanceRangeDto) {
    return this.finance.reconciliation(query);
  }

  @Get('reconciliation/export.csv')
  @RequirePermission('finance.reconcile', 'finance.export')
  @Audited('finance', 'finance.reconciliation.export')
  async exportCsv(@Query() query: FinanceRangeDto, @Res() res: Response, @Req() request: Request) {
    const range = await this.finance.reconciliation(query);
    if (query.view === 'lines') {
      const rows = await this.finance.lineRows(query);
      const result = await streamCsv(
        res,
        `reconciliation-lines-${range.range.from}_${range.range.to}.csv`,
        [
          { header: 'Date', value: (r) => r.date },
          { header: 'Type', value: (r) => r.type },
          { header: 'Booking', value: (r) => r.reference },
          { header: 'Order', value: (r) => r.orderReference },
          { header: 'Payment reference', value: (r) => r.paymentReference },
          { header: 'Mode', value: (r) => r.mode },
          { header: 'Amount AED', value: (r) => r.amount },
        ],
        rows,
      );
      setAuditContext(request, { summary: `Exported ${result.written} reconciliation lines ${range.range.from} to ${range.range.to}` });
      return;
    }
    const rows = [...range.days].reverse();
    await streamCsv(
      res,
      `reconciliation-${range.range.from}_${range.range.to}.csv`,
      [
        { header: 'Date', value: (r) => r.date },
        { header: 'Payments', value: (r) => r.paymentsCount },
        { header: 'Payments AED', value: (r) => r.payments },
        { header: 'Refunds', value: (r) => r.refundsCount },
        { header: 'Refunds AED', value: (r) => r.refunds },
        { header: 'Net AED', value: (r) => r.net },
        { header: 'Orders paid', value: (r) => r.ordersPaidCount },
        { header: 'Orders paid AED', value: (r) => r.ordersPaid },
        { header: 'Variance AED', value: (r) => r.variance },
      ],
      rows,
    );
    setAuditContext(request, { summary: `Exported daily reconciliation ${range.range.from} to ${range.range.to}` });
  }

  @Get('reconciliation/:date')
  @RequirePermission('finance.reconcile')
  @Header('Cache-Control', 'no-store')
  day(@Param('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw appError(400, 'INVALID_DATE', 'date must be YYYY-MM-DD');
    return this.finance.dayLines(date);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/invoices')
@UseInterceptors(AuditInterceptor)
export class AdminInvoicesController {
  constructor(
    private readonly billing: BillingService,
    private readonly settings: SettingsService,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
  ) {}

  @Get()
  @RequirePermission('invoices.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Invoices and credit notes (filters: kind, status, created range, q)' })
  list(@Query() query: ListInvoicesDto) {
    return this.billing.search(query);
  }

  @Get('export.csv')
  @RequirePermission('invoices.export')
  @Audited('invoice', 'invoice.export')
  async exportCsv(@Query() query: ListInvoicesDto, @Res() res: Response, @Req() request: Request) {
    const result = await streamCsv(
      res,
      'invoices.csv',
      [
        { header: 'Number', value: (r) => r.invoiceNumber },
        { header: 'Type', value: (r) => r.kind },
        { header: 'Status', value: (r) => r.status },
        { header: 'Issued', value: (r) => r.issuedAt },
        { header: 'Booking', value: (r) => r.bookingReference },
        { header: 'Against invoice', value: (r) => r.relatedInvoiceNumber },
        { header: 'Customer', value: (r) => r.customerName },
        { header: 'Email', value: (r) => r.customerEmail },
        { header: 'Subtotal', value: (r) => r.subtotal },
        { header: 'Discount', value: (r) => r.discount },
        { header: 'Tax', value: (r) => r.tax },
        { header: 'Total', value: (r) => r.total },
        { header: 'Currency', value: (r) => r.currency },
      ],
      this.billing.exportRows(query),
    );
    setAuditContext(request, { summary: `Exported ${result.written} invoices${result.truncated ? ' (capped at 10,000)' : ''}` });
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('invoices.write')
  @Audited('invoice', 'invoice.generate')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Generate the invoice of a paid booking that has none yet (idempotent)' })
  async generate(@Body() dto: GenerateInvoiceDto, @Req() request: Request) {
    const booking = await this.bookings.findById(dto.bookingId).lean().exec();
    if (!booking) throw appError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (!booking.confirmedAt) throw appError(409, 'NOT_PAID', 'Only a paid booking can be invoiced');
    const { taxPercent } = await this.settings.getCommerce();
    const invoice = await this.billing.createForBooking(booking, taxPercent);
    setAuditContext(request, { entityId: invoice._id.toString(), summary: `Generated invoice ${invoice.invoiceNumber} for ${booking.reference}` });
    return this.billing.toView(invoice.toObject());
  }

  @Get(':id')
  @RequirePermission('invoices.read')
  @Header('Cache-Control', 'no-store')
  async get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.billing.toView(await this.billing.getById(id));
  }

  @Post(':id/email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('invoices.write')
  @Audited('invoice', 'invoice.email')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'E-mail the invoice or credit note PDF (defaults to the buyer e-mail); 409 EMAIL_NOT_CONFIGURED without SMTP' })
  async email(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: EmailInvoiceDto, @Req() request: Request) {
    const result = await this.billing.emailInvoice(id, dto.to);
    setAuditContext(request, { entityId: id, summary: `E-mailed document ${id}: ${result.status}`, changes: [] });
    return result;
  }

  @Get(':id/pdf')
  @RequirePermission('invoices.read')
  @Header('Cache-Control', 'no-store')
  async pdf(@Param('id', ParseObjectIdPipe) id: string, @Res() res: Response) {
    const invoice = await this.billing.getById(id);
    const buffer = await this.billing.pdfFor(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(buffer);
  }
}
