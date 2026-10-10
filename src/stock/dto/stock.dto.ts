import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ENQUIRY_SOURCES, MANUAL_PRODUCT_TYPES, MOVEMENT_TYPES, PAYMENT_MODES, PRODUCT_TYPES } from '../stock.types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CAPACITY = 1_000_000;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const ITEM_STATUS_FILTERS = ['low', 'sold_out', 'closed', 'ok', 'unlimited'] as const;
export const ITEM_SORTS = ['attention', 'title', 'type', 'available'] as const;
export const DAY_MODES = ['set', 'add', 'remove', 'clear'] as const;

/** `GET /admin/stock/items`. */
export class ListStockItemsDto {
  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  type?: string;

  @ApiPropertyOptional({ description: 'Matches title, product reference and variant' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ITEM_STATUS_FILTERS })
  @IsOptional()
  @IsIn(ITEM_STATUS_FILTERS)
  status?: (typeof ITEM_STATUS_FILTERS)[number];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: ITEM_SORTS, default: 'attention' })
  @IsOptional()
  @IsIn(ITEM_SORTS)
  sort?: (typeof ITEM_SORTS)[number];
}

/** `GET /admin/stock/items/:id?from=&to=` (max 93 days, default the current month). */
export class ItemDaysQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/** `PATCH /admin/stock/items/:id`. `defaultCapacity: null` = unlimited. */
export class UpdateStockItemDto {
  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAPACITY)
  defaultCapacity?: number | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stopSale?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Cost per unit (Phase 2 margin reports)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitCost?: number | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** `PUT /admin/stock/items/:id/days`. */
export class UpdateStockDaysDto {
  @ApiProperty({ example: '2026-10-01' })
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to: string;

  @ApiPropertyOptional({ type: [Number], description: '0 = Sunday .. 6 = Saturday; omitted = every day' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiProperty({ enum: DAY_MODES })
  @IsIn(DAY_MODES)
  mode: (typeof DAY_MODES)[number];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAPACITY)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  closed?: boolean;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({ maxLength: 300, description: 'Required for add and remove' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** `POST /admin/stock/items`: a manual item. */
export class CreateStockItemDto {
  @ApiProperty({ enum: MANUAL_PRODUCT_TYPES })
  @IsIn(MANUAL_PRODUCT_TYPES)
  productType: (typeof MANUAL_PRODUCT_TYPES)[number];

  @ApiProperty({ example: 'sunset-yacht' })
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/, { message: 'productRef must be a lowercase slug (letters, digits, hyphens)' })
  productRef: string;

  @ApiPropertyOptional({ default: 'default' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/, { message: 'variantId may contain letters, digits, spaces, dot, underscore and hyphen' })
  variantId?: string;

  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  variantLabel?: string;

  @ApiProperty({ nullable: true, minimum: 0, description: 'Units per day; null = unlimited' })
  @ValidateIf((o: CreateStockItemDto) => o.defaultCapacity !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_CAPACITY)
  defaultCapacity: number | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  lowStockThreshold?: number;
}

/** `GET /admin/stock/movements`. */
export class ListMovementsDto {
  @ApiPropertyOptional({ description: 'Item id: productType:productRef:variantId' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  itemId?: string;

  @ApiPropertyOptional({ enum: MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(MOVEMENT_TYPES)
  type?: string;

  @ApiPropertyOptional({ description: 'Actor e-mail (contains) or user id' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  actor?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/** `POST /admin/stock/bookings/:bookingId/return-to-stock`. */
export class ReturnToStockDto {
  @ApiProperty({ maxLength: 300 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}

/** `POST /admin/stock/enquiry-bookings`. */
export class EnquiryBookingDto {
  @ApiProperty({ enum: ENQUIRY_SOURCES })
  @IsIn(ENQUIRY_SOURCES)
  source: (typeof ENQUIRY_SOURCES)[number];

  @ApiProperty({ description: 'Id of the holiday / cruise / event enquiry' })
  @Matches(/^[a-f0-9]{24}$/i, { message: 'enquiryId must be an enquiry id' })
  enquiryId: string;

  @ApiProperty({ description: 'default for holidays, the cabin type for cruises, the ticket type for events' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  variantId: string;

  @ApiProperty({ example: '2026-11-05' })
  @Matches(DAY, { message: 'serviceDay must be YYYY-MM-DD' })
  serviceDay: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(500)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  adults?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  children?: number;

  @ApiProperty({ description: 'Amount received, in the given currency' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  totalAmount: number;

  @ApiProperty({ example: 'AED' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency: string;

  @ApiProperty({ enum: PAYMENT_MODES })
  @IsIn(PAYMENT_MODES)
  paymentMode: (typeof PAYMENT_MODES)[number];

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}
