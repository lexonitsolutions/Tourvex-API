import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermission } from '../admin/require-permission.decorator';
import { AuditService } from '../audit/audit.service';
import { diffChanges } from '../audit/redact';
import { recordCatalogAudit } from '../common/catalog/admin-catalog';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreatePurchaseDto,
  CreateSupplierDto,
  ListPurchasesDto,
  ListSuppliersDto,
  MarkPaidDto,
  UpdatePurchaseDto,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { PurchasingService, type PurchaseOutcome } from './purchasing.service';

const actorOf = (user: AuthenticatedUser) => ({ id: user.sub, email: user.email });

const pick = (source: object, fields: string[]) =>
  Object.fromEntries(fields.map((field) => [field, (source as Record<string, unknown>)[field]]));

/** Suppliers and stock purchases (`/admin/purchasing`, see docs/BILLING_API.md). Every response is `no-store`. */
@ApiTags('admin-purchasing')
@ApiBearerAuth()
@Controller('admin/purchasing')
export class PurchasingController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ suppliers

  @Get('suppliers')
  @RequirePermission('purchasing.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Suppliers (search, active filter, paginated)' })
  listSuppliers(@Query() query: ListSuppliersDto) {
    return this.purchasing.listSuppliers(query);
  }

  @Post('suppliers')
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create a supplier' })
  async createSupplier(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const supplier = await this.purchasing.createSupplier(dto);
    await recordCatalogAudit(this.audit, user, request, 'supplier', {
      action: 'supplier.create',
      entityId: supplier.id,
      summary: `Created supplier "${supplier.name}"`,
      changes: [{ field: 'name', from: null, to: supplier.name }],
    });
    return supplier;
  }

  @Get('suppliers/:id')
  @RequirePermission('purchasing.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One supplier' })
  getSupplier(@Param('id') id: string) {
    return this.purchasing.getSupplier(id);
  }

  @Patch('suppliers/:id')
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Edit or deactivate a supplier' })
  async updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const { before, after } = await this.purchasing.updateSupplier(id, dto);
    await recordCatalogAudit(this.audit, user, request, 'supplier', {
      action: 'supplier.update',
      entityId: id,
      summary: `Updated supplier "${after.name}"`,
      changes: diffChanges(before, pick(after, Object.keys(dto))),
    });
    return after;
  }

  @Delete('suppliers/:id')
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Delete a supplier without purchases (409 SUPPLIER_IN_USE otherwise)' })
  async deleteSupplier(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const supplier = await this.purchasing.deleteSupplier(id);
    await recordCatalogAudit(this.audit, user, request, 'supplier', {
      action: 'supplier.delete',
      entityId: id,
      summary: `Deleted supplier "${supplier.name}"`,
    });
    return { deleted: true, id };
  }

  // ------------------------------------------------------------------ purchases

  @Get('summary')
  @RequirePermission('purchasing.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Dashboard card: drafts, received-unpaid total, overdue count, last 30 days' })
  summary() {
    return this.purchasing.summary();
  }

  @Get('purchases')
  @RequirePermission('purchasing.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Purchases with filters, pagination and totals' })
  listPurchases(@Query() query: ListPurchasesDto) {
    return this.purchasing.listPurchases(query);
  }

  @Post('purchases')
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create a draft purchase' })
  async createPurchase(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const purchase = await this.purchasing.createPurchase(dto, actorOf(user));
    await recordCatalogAudit(this.audit, user, request, 'purchase', {
      action: 'purchase.create',
      entityId: purchase.id,
      summary: `Created draft purchase ${purchase.number} from ${purchase.supplierName}`,
      changes: [
        { field: 'supplierId', from: null, to: purchase.supplierId },
        { field: 'lines', from: null, to: purchase.lines.length },
        { field: 'total', from: null, to: purchase.total },
      ],
    });
    return purchase;
  }

  @Get('purchases/:id')
  @RequirePermission('purchasing.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One purchase with its lines' })
  getPurchase(@Param('id') id: string) {
    return this.purchasing.getPurchase(id);
  }

  @Patch('purchases/:id')
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Edit a draft purchase (received and paid purchases accept a notes-only change)' })
  async updatePurchase(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const { before, after } = await this.purchasing.updatePurchase(id, dto);
    const { lines, ...fields } = dto;
    const changes = diffChanges(before, pick(after, Object.keys(fields)));
    if (lines) changes.push({ field: 'lines', from: before.lines.length, to: after.lines.length });
    await recordCatalogAudit(this.audit, user, request, 'purchase', {
      action: 'purchase.update',
      entityId: id,
      summary: `Updated purchase ${after.number}`,
      changes,
    });
    return after;
  }

  private async audited(
    outcome: PurchaseOutcome,
    action: string,
    summary: string,
    user: AuthenticatedUser,
    request: Request,
    changes: Array<{ field: string; from: unknown; to: unknown }>,
  ) {
    if (outcome.changed) {
      await recordCatalogAudit(this.audit, user, request, 'purchase', {
        action,
        entityId: outcome.purchase.id,
        summary: `${summary} ${outcome.purchase.number}`,
        changes,
      });
    }
    return outcome.purchase;
  }

  @Post('purchases/:id/receive')
  @HttpCode(200)
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Receive: add the units to stock in one transaction (idempotent)' })
  async receive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const outcome = await this.purchasing.receive(id, actorOf(user));
    return this.audited(outcome, 'purchase.receive', 'Received purchase', user, request, [
      { field: 'status', from: 'draft', to: 'received' },
      { field: 'totalUnits', from: null, to: outcome.purchase.totalUnits },
    ]);
  }

  @Post('purchases/:id/void')
  @HttpCode(200)
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Void a draft or received purchase (a received one takes its units out of stock again)' })
  async void(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const outcome = await this.purchasing.voidPurchase(id, actorOf(user));
    return this.audited(outcome, 'purchase.void', 'Voided purchase', user, request, [{ field: 'status', from: null, to: 'void' }]);
  }

  @Post('purchases/:id/mark-paid')
  @HttpCode(200)
  @RequirePermission('purchasing.write')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Mark a received purchase as paid to the supplier' })
  async markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const outcome = await this.purchasing.markPaid(id, dto);
    return this.audited(outcome, 'purchase.mark_paid', 'Marked paid purchase', user, request, [
      { field: 'status', from: 'received', to: 'paid' },
      ...(dto.reference ? [{ field: 'paymentReference', from: null, to: dto.reference }] : []),
    ]);
  }
}
