import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ISO_DATE_PATTERN, OPTION_ID_PATTERN } from '../../catalog/dto/activity-booking.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Add an item to the cart, or modify one (`PATCH /checkout/cart/items/:itemId`). */
export class CartItemDto {
  @ApiPropertyOptional({ enum: ['activity', 'visa', 'yacht', 'event'], default: 'activity' })
  @IsOptional()
  @IsIn(['activity', 'visa', 'yacht', 'event'])
  productType?: 'activity' | 'visa' | 'yacht' | 'event';

  @ApiPropertyOptional({ example: 'burj-khalifa-at-the-top-activities' })
  @ValidateIf((o: CartItemDto) => !o.productSlug)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,199}$/, { message: 'activitySlug is invalid' })
  activitySlug?: string;

  @ApiPropertyOptional({ example: 'maldives-escape' })
  @ValidateIf((o: CartItemDto) => o.productType !== undefined && o.productType !== 'activity')
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,199}$/, { message: 'productSlug is invalid' })
  productSlug?: string;

  /** Existing direct booking action; it is not exposed as the standalone Add to Cart control. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  bookingOnly?: boolean;

  @ApiProperty()
  @IsString()
  @Matches(OPTION_ID_PATTERN, { message: 'optionId is invalid' })
  optionId: string;

  @ApiProperty({ example: '2026-10-05' })
  @Matches(ISO_DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(50)
  adults: number;

  @ApiProperty({ minimum: 0, default: 0 })
  @IsInt()
  @Min(0)
  @Max(50)
  children: number;

  @ApiPropertyOptional({ example: 'IN' }) @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/) nationality?: string;
  @ApiPropertyOptional({ example: 'AE' }) @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/) residence?: string;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsInt({ each: true }) @Min(0, { each: true }) @Max(17, { each: true }) minorAges?: number[];
}

export class CartQueryDto {
  @ApiPropertyOptional({ description: 'Indicative display currency for pricing.display.' })
  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class PickupDto {
  @ApiProperty({ enum: ['now', 'later'] })
  @IsIn(['now', 'later'])
  mode: 'now' | 'later';

  @ApiPropertyOptional({ description: 'Required when mode is "now".' })
  @ValidateIf((o: PickupDto) => o.mode === 'now' || o.locationName !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  locationName?: string;

  @ApiPropertyOptional({ description: 'Required when mode is "now".' })
  @ValidateIf((o: PickupDto) => o.mode === 'now' || o.address !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}

/** Free-text only, strict whitelist. Sending `{}` marks the step complete. */
export class AdditionalDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => trim({ value: v })) : value))
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  leadTravellerNames?: string[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  specialRequests?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  arrivalFlight?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  hotelName?: string;
}

export class CustomerDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email: string;

  @ApiProperty({ example: '+971' })
  @Matches(/^\+\d{1,4}$/, { message: 'phoneCountryCode must look like +971' })
  phoneCountryCode: string;

  @ApiProperty({ example: '501234567' })
  @Matches(/^\d{6,15}$/, { message: 'phone must be 6-15 digits' })
  phone: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nationality: string;

  @IsBoolean()
  marketingOptOut: boolean;
}

export class ApplyPromoDto {
  @ApiProperty({ example: 'WELCOME10' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,32}$/, { message: 'code is invalid' })
  code: string;
}

export class UpsertPromoDto {
  @ApiProperty({ example: 'WELCOME10' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,32}$/, { message: 'code must be 3-32 characters: A-Z, 0-9, _ or -' })
  code: string;

  @IsIn(['percent', 'fixed'])
  type: 'percent' | 'fixed';

  /** Percent 1-100 or a fixed AED amount; the service checks the range for the type. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000)
  value: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minSubtotal?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  appliesTo?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsBoolean()
  isSample?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

/** Update: the code itself is immutable; every other field optional. */
export class UpdatePromoDto {
  @IsOptional()
  @IsIn(['percent', 'fixed'])
  type?: 'percent' | 'fixed';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000)
  value?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minSubtotal?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  appliesTo?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
