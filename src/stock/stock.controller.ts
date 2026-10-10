import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermission } from '../admin/require-permission.decorator';
import { AuditService } from '../audit/audit.service';
import { recordCatalogAudit } from '../common/catalog/admin-catalog';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateStockItemDto,
  EnquiryBookingDto,
  ItemDaysQueryDto,
  ListMovementsDto,
  ListStockItemsDto,
  ReturnToStockDto,
  UpdateStockDaysDto,
  UpdateStockItemDto,
} from './dto/stock.dto';
import { EnquiryBookingService } from './enquiry-booking.service';
import { StockAdminService } from './stock-admin.service';

const actorOf = (user: AuthenticatedUser) => ({ id: user.sub, email: user.email });

/** Stock and availability admin API (`/admin/stock`, see docs/STOCK_API.md). Every response is `no-store`. */
@ApiTags('admin-stock')
@ApiBearerAuth()
@Controller('admin/stock')
export class StockController {
  constructor(
    private readonly stock: StockAdminService,
    private readonly enquiryBookings: EnquiryBookingService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @RequirePermission('stock.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Low stock, sold out and stopped counts over the next 30 days, plus the items needing attention' })
  summary() {
    return this.stock.summary();
  }

  @Get('items')
  @RequirePermission('stock.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stock items (catalog variants and manual items), filterable and paginated' })
  listItems(@Query() query: ListStockItemsDto) {
    return this.stock.listItems(query);
  }

  @Get('movements')
  @RequirePermission('stock.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stock ledger, newest first' })
  movements(@Query() query: ListMovementsDto) {
    return this.stock.listMovements(query);
  }

  @Get('items/:id')
  @RequirePermission('stock.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One item with its day-by-day figures (max 93 days, default the current month)' })
  item(@Param('id') id: string, @Query() query: ItemDaysQueryDto) {
    return this.stock.getItem(id, query);
  }

  @Patch('items/:id')
  @RequirePermission('stock.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Change default capacity, low-stock threshold, stop-sale or unit cost' })
  async updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateStockItemDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const { before, after } = await this.stock.updateItem(id, dto, actorOf(user));
    const fields = ['defaultCapacity', 'lowStockThreshold', 'stopSale', 'unitCost'] as const;
    await recordCatalogAudit(this.audit, user, request, 'stock_item', {
      action: 'stock.update',
      entityId: id,
      summary: `Updated stock settings of "${after.title}${after.variantLabel ? ` - ${after.variantLabel}` : ''}"${dto.reason ? `: ${dto.reason}` : ''}`,
      changes: fields
        .filter((field) => dto[field] !== undefined && before[field] !== after[field])
        .map((field) => ({ field, from: before[field], to: after[field] })),
    });
    return after;
  }

  @Put('items/:id/days')
  @RequirePermission('stock.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Set, add, remove or clear per-date capacity overrides and close or open dates' })
  async updateDays(
    @Param('id') id: string,
    @Body() dto: UpdateStockDaysDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.stock.updateDays(id, dto, actorOf(user));
    await recordCatalogAudit(this.audit, user, request, 'stock_day', {
      action: `stock.days.${dto.mode}`,
      entityId: id,
      summary: `Stock ${dto.mode} for ${result.updated} date(s) ${dto.from} to ${dto.to}${dto.reason ? `: ${dto.reason}` : ''}`,
      changes: [
        { field: 'range', from: null, to: `${dto.from}..${dto.to}` },
        ...(dto.capacity !== undefined ? [{ field: 'capacity', from: null, to: dto.capacity }] : []),
        ...(dto.closed !== undefined ? [{ field: 'closed', from: null, to: dto.closed }] : []),
      ],
    });
    return result;
  }

  @Post('items')
  @RequirePermission('stock.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create a manual stock item (yacht, transfer, hotel, custom)' })
  async createItem(@Body() dto: CreateStockItemDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const item = await this.stock.createItem(dto, actorOf(user));
    await recordCatalogAudit(this.audit, user, request, 'stock_item', {
      action: 'stock.create',
      entityId: item.id,
      summary: `Created stock item "${item.title}"`,
      changes: [
        { field: 'productType', from: null, to: item.productType },
        { field: 'defaultCapacity', from: null, to: item.defaultCapacity },
      ],
    });
    return item;
  }

  @Post('bookings/:bookingId/return-to-stock')
  @HttpCode(200)
  @RequirePermission('stock.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Return the kept units of a cancelled or refunded booking to stock' })
  async returnToStock(
    @Param('bookingId') bookingId: string,
    @Body() dto: ReturnToStockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const { before, after, ...result } = await this.stock.returnToStock(bookingId, dto.reason, actorOf(user));
    await recordCatalogAudit(this.audit, user, request, 'booking', {
      action: 'stock.return',
      entityId: result.booking.id,
      summary: `Returned ${result.returned} unit(s) of ${result.booking.reference} to stock: ${dto.reason}`,
      changes: [{ field: 'stockReleased', from: before.stockReleased, to: after.stockReleased }],
    });
    return result;
  }

  @Post('enquiry-bookings')
  @RequirePermission('enquiries.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Confirm a holiday, cruise or event enquiry into a booking (reduces stock, issues invoice and voucher)' })
  async confirmEnquiry(@Body() dto: EnquiryBookingDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const result = await this.enquiryBookings.confirm(dto, actorOf(user));
    await recordCatalogAudit(this.audit, user, request, 'booking', {
      action: 'stock.enquiry_booking',
      entityId: result.booking.id,
      summary: `Confirmed ${dto.source} enquiry ${result.booking.enquiryReference} into booking ${result.booking.reference}`,
      changes: [
        { field: 'enquiryId', from: null, to: dto.enquiryId },
        { field: 'quantity', from: null, to: dto.quantity },
        { field: 'serviceDay', from: null, to: dto.serviceDay },
        { field: 'totalAmount', from: null, to: dto.totalAmount },
        { field: 'paymentMode', from: null, to: dto.paymentMode },
      ],
    });
    return result;
  }
}
