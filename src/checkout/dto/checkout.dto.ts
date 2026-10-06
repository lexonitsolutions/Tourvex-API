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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { QuoteDto } from '../../catalog/dto/activity-booking.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Add an item to the cart, or modify one (`PATCH /checkout/cart/items/:itemId`). */
export class CartItemDto extends QuoteDto {
  @ApiProperty({ example: 'burj-khalifa-at-the-top-activities' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,199}$/, { message: 'activitySlug is invalid' })
  activitySlug: string;
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
