import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../admin/require-permission.decorator';
import { Audited, AuditInterceptor } from '../audit/audited';
import {
  CreateRegimeDto,
  CreateSellerDto,
  TaxPreviewDto,
  UpdateRegimeDto,
  UpdateSellerDto,
  UpdateTaxSettingsDto,
} from './tax.dto';
import { TaxAdminService } from './tax-admin.service';

/** Tax tables admin API (`/admin/tax`, see docs/BILLING_API.md). Every response is `no-store`; every mutation is audited. */
@ApiTags('admin-tax')
@ApiBearerAuth()
@Controller('admin/tax')
@UseInterceptors(AuditInterceptor)
export class TaxController {
  constructor(private readonly tax: TaxAdminService) {}

  @Get('regimes')
  @RequirePermission('tax.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Tax regimes (one per country)' })
  regimes() {
    return this.tax.listRegimes();
  }

  @Post('regimes')
  @HttpCode(201)
  @RequirePermission('tax.write')
  @Audited('tax_regime', 'tax.regime.create')
  @Header('Cache-Control', 'no-store')
  createRegime(@Body() dto: CreateRegimeDto) {
    return this.tax.createRegime(dto);
  }

  @Patch('regimes/:id')
  @RequirePermission('tax.write')
  @Audited('tax_regime', 'tax.regime.update')
  @Header('Cache-Control', 'no-store')
  updateRegime(@Param('id') id: string, @Body() dto: UpdateRegimeDto) {
    return this.tax.updateRegime(id, dto);
  }

  @Delete('regimes/:id')
  @RequirePermission('tax.write')
  @Audited('tax_regime', 'tax.regime.delete')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '409 REGIME_IN_USE when an invoice or booking uses it: deactivate instead' })
  deleteRegime(@Param('id') id: string) {
    return this.tax.deleteRegime(id);
  }

  @Get('sellers')
  @RequirePermission('tax.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Seller registrations (the legal entities that issue invoices)' })
  sellers() {
    return this.tax.listSellers();
  }

  @Post('sellers')
  @HttpCode(201)
  @RequirePermission('tax.write')
  @Audited('tax_seller', 'tax.seller.create')
  @Header('Cache-Control', 'no-store')
  createSeller(@Body() dto: CreateSellerDto) {
    return this.tax.createSeller(dto);
  }

  @Patch('sellers/:id')
  @RequirePermission('tax.write')
  @Audited('tax_seller', 'tax.seller.update')
  @Header('Cache-Control', 'no-store')
  updateSeller(@Param('id') id: string, @Body() dto: UpdateSellerDto) {
    return this.tax.updateSeller(id, dto);
  }

  @Delete('sellers/:id')
  @RequirePermission('tax.write')
  @Audited('tax_seller', 'tax.seller.delete')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '409 SELLER_IN_USE when invoices exist; the default seller cannot be deleted' })
  deleteSeller(@Param('id') id: string) {
    return this.tax.deleteSeller(id);
  }

  @Get('settings')
  @RequirePermission('tax.read')
  @Header('Cache-Control', 'no-store')
  settings() {
    return this.tax.getSettings();
  }

  @Patch('settings')
  @RequirePermission('tax.write')
  @Audited('tax_settings', 'tax.settings.update')
  @Header('Cache-Control', 'no-store')
  updateSettings(@Body() dto: UpdateTaxSettingsDto) {
    return this.tax.updateSettings(dto);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('tax.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Calculator: the tax, split and seller for an amount in a country' })
  preview(@Body() dto: TaxPreviewDto) {
    return this.tax.preview(dto);
  }

  @Get('countries')
  @RequirePermission('tax.read')
  @Header('Cache-Control', 'no-store')
  countries() {
    return this.tax.countries();
  }
}
