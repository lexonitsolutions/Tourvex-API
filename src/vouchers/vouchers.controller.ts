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
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { streamCsv } from '../common/csv/csv';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { ListVouchersDto, VoidVoucherDto, VoucherCodeDto } from './vouchers.dto';
import { VouchersService } from './vouchers.service';

const actorOf = (user: AuthenticatedUser) => ({ id: user.sub, name: user.email, email: user.email });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/vouchers')
@UseInterceptors(AuditInterceptor)
export class AdminVouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @RequirePermission('vouchers.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List vouchers (filters: status, activity, service date range, redeemed range, q)' })
  list(@Query() query: ListVouchersDto) {
    return this.vouchers.list(query);
  }

  @Get('export.csv')
  @RequirePermission('vouchers.export')
  @Audited('voucher', 'voucher.export')
  async exportCsv(@Query() query: ListVouchersDto, @Res() res: Response, @Req() request: Request) {
    const rows = this.rows(query);
    const result = await streamCsv(
      res,
      'vouchers.csv',
      [
        { header: 'Code', value: (r) => r.displayCode },
        { header: 'Status', value: (r) => r.status },
        { header: 'Booking', value: (r) => r.bookingReference },
        { header: 'Activity', value: (r) => r.activityTitle },
        { header: 'Service day', value: (r) => r.serviceDay },
        { header: 'Travellers', value: (r) => r.travellers },
        { header: 'Customer', value: (r) => r.customerName },
        { header: 'Issued', value: (r) => r.issuedAt },
        { header: 'Redeemed', value: (r) => r.redeemedAt },
        { header: 'Redeemed by', value: (r) => r.redeemedByName },
      ],
      rows,
    );
    setAuditContext(request, { summary: `Exported ${result.written} vouchers${result.truncated ? ' (capped)' : ''}` });
  }

  /** Read-only check (no state change): is this code redeemable right now? */
  @Post('validate')
  @HttpCode(200)
  @RequirePermission('vouchers.validate')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Validate a scanned code: date window, void and already-redeemed checks' })
  validate(@Body() dto: VoucherCodeDto) {
    return this.vouchers.validate(dto.code);
  }

  @Get(':id')
  @RequirePermission('vouchers.read')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.vouchers.getView(id);
  }

  @Post(':id/redeem')
  @HttpCode(200)
  @RequirePermission('vouchers.validate')
  @Audited('voucher', 'voucher.redeem')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Atomically redeem an issued voucher; a second scan answers 409 ALREADY_REDEEMED' })
  async redeem(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.vouchers.redeem(id, actorOf(user));
    setAuditContext(request, {
      entityId: id,
      summary: `Redeemed voucher for booking ${result.bookingReference}`,
      changes: [{ field: 'status', from: 'issued', to: 'redeemed' }],
    });
    return result;
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('vouchers.write')
  @Audited('voucher', 'voucher.void')
  @Header('Cache-Control', 'no-store')
  async void(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: VoidVoucherDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.vouchers.voidVoucher(id, actorOf(user), dto.reason);
    setAuditContext(request, {
      entityId: id,
      summary: `Voided voucher for booking ${result.bookingReference}: ${dto.reason}`,
      changes: [{ field: 'status', from: 'issued', to: 'void' }],
    });
    return result;
  }

  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermission('vouchers.write')
  @Audited('voucher', 'voucher.resend')
  @Header('Cache-Control', 'no-store')
  async resend(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.vouchers.resend(id, actorOf(user));
    setAuditContext(request, { entityId: id, summary: `Resent voucher for booking ${result.bookingReference}` });
    return result;
  }

  private async *rows(query: ListVouchersDto) {
    const limit = 100;
    for (let page = 1; page <= 100; page++) {
      const { items, pagination } = await this.vouchers.list({ ...query, page, limit });
      yield* items;
      if (page >= pagination.pages) return;
    }
  }
}

/** The URL inside every QR code lands here (via the website's /v/<code> page). */
@ApiTags('vouchers')
@Controller('vouchers')
export class PublicVouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Public()
  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Public validity check for a voucher code: activity, date, travellers, status only' })
  lookup(@Param('code') code: string) {
    return this.vouchers.publicLookup(code);
  }
}
