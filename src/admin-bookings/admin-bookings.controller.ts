import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { streamCsv } from '../common/csv/csv';
import { AddNoteDto } from '../common/notes/notes';
import { appError } from '../common/app-error';
import {
  ApproveCancellationDto,
  CancelBookingDto,
  ChangeServiceDateDto,
  ConfirmBookingDto,
  ListBookingsDto,
  ListOrdersDto,
  RefundBookingDto,
  RejectCancellationDto,
} from './admin-bookings.dto';
import { Actor, AdminBookingsService } from './admin-bookings.service';

const actorOf = (user: AuthenticatedUser): Actor => ({ id: user.sub, email: user.email, roles: user.roles });
const OBJECT_OR_REFERENCE = /^([a-f0-9]{24}|TVX-\d{4}-[A-Z0-9]{8})$/i;

/** Rejects ids that are neither a Mongo id nor a booking reference before they reach a query. */
function bookingKey(id: string): string {
  if (!OBJECT_OR_REFERENCE.test(id)) throw appError(400, 'INVALID_ID', 'id must be a booking id or reference');
  return id;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/bookings')
@UseInterceptors(AuditInterceptor)
export class AdminBookingsController {
  constructor(private readonly service: AdminBookingsService) {}

  @Get()
  @RequirePermission('bookings.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List bookings: search, status/service type/activity/payment filters, created and service date ranges' })
  list(@Query() query: ListBookingsDto) {
    return this.service.list(query);
  }

  @Get('export.csv')
  @RequirePermission('bookings.export')
  @Audited('booking', 'booking.export')
  async exportCsv(@Query() query: ListBookingsDto, @Res() res: Response, @Req() request: Request) {
    const result = await streamCsv(
      res,
      'bookings.csv',
      [
        { header: 'Reference', value: (r) => r.reference },
        { header: 'Order', value: (r) => r.orderReference },
        { header: 'Status', value: (r) => r.status },
        { header: 'Payment status', value: (r) => r.paymentStatus },
        { header: 'Service type', value: (r) => r.serviceType },
        { header: 'Activity', value: (r) => r.title },
        { header: 'Option', value: (r) => r.optionName },
        { header: 'Service day', value: (r) => r.serviceDay },
        { header: 'Adults', value: (r) => r.adults },
        { header: 'Children', value: (r) => r.children },
        { header: 'Customer', value: (r) => r.customerName },
        { header: 'Email', value: (r) => r.customerEmail },
        { header: 'Total', value: (r) => r.total },
        { header: 'Refunded', value: (r) => r.refundedAmount },
        { header: 'Currency', value: (r) => r.currency },
        { header: 'Created', value: (r) => r.createdAt },
      ],
      this.service.exportRows(query),
    );
    setAuditContext(request, { summary: `Exported ${result.written} bookings${result.truncated ? ' (capped at 10,000)' : ''}` });
  }

  @Get('summary')
  @RequirePermission('bookings.read')
  @Header('Cache-Control', 'no-store')
  summary() {
    return this.service.summary();
  }

  @Get('cancellation-requests')
  @RequirePermission('bookings.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Customer cancellation requests awaiting a decision, oldest first, with the policy outcome' })
  cancellationRequests(@Query() query: ListBookingsDto) {
    return this.service.listCancellationRequests(query);
  }

  @Get('orders')
  @RequirePermission('bookings.read')
  @Header('Cache-Control', 'no-store')
  orders(@Query() query: ListOrdersDto) {
    return this.service.listOrders(query);
  }

  @Get('orders/:orderReference')
  @RequirePermission('bookings.read')
  @Header('Cache-Control', 'no-store')
  order(@Param('orderReference') orderReference: string) {
    if (!/^OR-[A-Z0-9]{8}$/.test(orderReference)) throw appError(400, 'INVALID_ID', 'Not an order reference');
    return this.service.getOrder(orderReference);
  }

  @Get(':id')
  @RequirePermission('bookings.read')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(bookingKey(id), actorOf(user));
  }

  @Post(':id/notes')
  @RequirePermission('bookings.write')
  @Audited('booking', 'booking.note')
  @Header('Cache-Control', 'no-store')
  async addNote(
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const note = await this.service.addNote(bookingKey(id), dto.text, actorOf(user));
    setAuditContext(request, { entityId: id, summary: 'Added an internal note', changes: [{ field: 'notes', from: null, to: '[note added]' }] });
    return note;
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermission('bookings.write')
  @Audited('booking', 'booking.confirm')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Confirm an unpaid booking by recording an offline payment reference' })
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmBookingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const view = await this.service.confirm(bookingKey(id), dto.paymentReference, actorOf(user));
    this.audit(request, view, `Confirmed booking ${view.reference} (payment ref ${dto.paymentReference})`);
    return view;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('bookings.cancel')
  @Audited('booking', 'booking.cancel')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Cancel a booking; refund by policy, in full, custom or none (a refund also needs bookings.refund)' })
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const view = await this.service.cancel(bookingKey(id), dto, actorOf(user));
    this.audit(request, view, `Cancelled booking ${view.reference}: ${dto.reason}`);
    return view;
  }

  @Post(':id/cancellation/approve')
  @HttpCode(200)
  @RequirePermission('bookings.cancel')
  @Audited('booking', 'booking.cancellation.approve')
  @Header('Cache-Control', 'no-store')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveCancellationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const view = await this.service.approveCancellation(bookingKey(id), dto, actorOf(user));
    this.audit(request, view, `Approved cancellation request of ${view.reference}`);
    return view;
  }

  @Post(':id/cancellation/reject')
  @HttpCode(200)
  @RequirePermission('bookings.cancel')
  @Audited('booking', 'booking.cancellation.reject')
  @Header('Cache-Control', 'no-store')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectCancellationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const view = await this.service.rejectCancellation(bookingKey(id), dto.reason, actorOf(user));
    this.audit(request, view, `Rejected cancellation request of ${view.reference}: ${dto.reason}`);
    return view;
  }

  @Post(':id/refund')
  @HttpCode(200)
  @RequirePermission('bookings.refund')
  @Audited('booking', 'booking.refund')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Record a refund (ledger + Stripe refund, simulated in mock mode); capped at the paid amount, never twice' })
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundBookingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.service.refund(bookingKey(id), dto, actorOf(user));
    setAuditContext(request, {
      entityId: result.booking.id,
      summary: `${result.replayed ? 'Replayed' : 'Refunded'} ${result.refund.currency} ${result.refund.amount.toFixed(2)} on ${result.booking.reference}: ${dto.reason}`,
      changes: [{ field: 'refundedAmount', from: null, to: result.refund.amount }],
    });
    return result;
  }

  @Post(':id/resend-confirmation')
  @HttpCode(200)
  @RequirePermission('bookings.write')
  @Audited('booking', 'booking.resend')
  @Header('Cache-Control', 'no-store')
  async resend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const view = await this.service.resend(bookingKey(id), actorOf(user));
    this.audit(request, view, `Resent confirmation of ${view.reference}`);
    return view;
  }

  @Patch(':id/service-date')
  @RequirePermission('bookings.write')
  @Audited('booking', 'booking.service_date')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Move an activity booking to another day (availability, pax and cut-off are re-checked)' })
  async serviceDate(
    @Param('id') id: string,
    @Body() dto: ChangeServiceDateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const view = await this.service.changeServiceDate(bookingKey(id), dto, actorOf(user));
    setAuditContext(request, {
      entityId: view.id,
      summary: `Moved ${view.reference} to ${dto.date}: ${dto.reason}`,
      changes: [view.change ?? { field: 'serviceDay', from: null, to: dto.date }],
    });
    return view;
  }

  private audit(request: Request, view: { id: string; status: string; previousStatus: string; reference: string }, summary: string) {
    setAuditContext(request, {
      entityId: view.id,
      summary,
      changes: [{ field: 'status', from: view.previousStatus, to: view.status }],
    });
  }
}
