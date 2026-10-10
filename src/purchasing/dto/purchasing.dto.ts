import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PURCHASE_STATUSES } from '../schemas/purchase.schema';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
/** An empty string skips the remaining validators, so an empty e-mail clears the field. */
const notEmpty = () => ValidateIf((_object, value) => value !== '');

export const MAX_LINES = 50;
export const MAX_QUANTITY = 1_000_000;
export const MAX_UNIT_COST = 10_000_000;

/** Own paging base: purchasing lists default to 25 rows and allow up to 200 (the shared base stops at 100). */
export class PurchasingPagingDto {
  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 25;
}

// ------------------------------------------------------------------ suppliers

export class CreateSupplierDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2' })
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter ISO code' })
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @notEmpty()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 365, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ default: 'AED' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter ISO code' })
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @notEmpty()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListSuppliersDto extends PurchasingPagingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

// ------------------------------------------------------------------ purchases

export class PurchaseLineDto {
  @ApiProperty({ description: 'Stock item id "type:ref:variant"' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  itemId: string;

  @ApiProperty({ description: 'Units added PER DAY', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity: number;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(DAY, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom: string;

  @ApiProperty({ example: '2026-11-30' })
  @Matches(DAY, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo: string;

  @ApiPropertyOptional({ description: '0 = Sunday .. 6 = Saturday; all days when omitted' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiProperty({ description: 'Cost of one unit, 2 decimals', minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_UNIT_COST)
  unitCost: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  taxPercent?: number;
}

export class CreatePurchaseDto {
  @ApiProperty()
  @IsMongoId()
  supplierId: string;

  @ApiPropertyOptional({ description: 'Unique per supplier' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  supplierInvoiceNumber?: string;

  @ApiProperty({ example: '2026-10-10' })
  @Matches(DAY, { message: 'invoiceDate must be YYYY-MM-DD' })
  invoiceDate: string;

  @ApiPropertyOptional({ description: 'Defaults to invoiceDate + the supplier payment terms' })
  @IsOptional()
  @Matches(DAY, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string;

  @ApiPropertyOptional({ default: 'AED', description: 'Only the base currency (AED) is supported' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiProperty({ type: [PurchaseLineDto], minItems: 1, maxItems: MAX_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines: PurchaseLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Draft edit: every field optional; `lines` replaces all lines. An empty `supplierInvoiceNumber` / `dueDate` clears it. */
export class UpdatePurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  supplierInvoiceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY, { message: 'invoiceDate must be YYYY-MM-DD' })
  invoiceDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'dueDate must be YYYY-MM-DD or empty' })
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional({ type: [PurchaseLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines?: PurchaseLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListPurchasesDto extends PurchasingPagingDto {
  @ApiPropertyOptional({ enum: PURCHASE_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: (typeof PURCHASE_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Invoice date from, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ description: 'Invoice date to (inclusive), YYYY-MM-DD' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class MarkPaidDto {
  @ApiPropertyOptional({ description: 'ISO date or date-time; defaults to now' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 120)
  reference?: string;
}
