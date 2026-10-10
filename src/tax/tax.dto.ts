import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
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
  ValidateNested,
} from 'class-validator';
import { QR_KINDS, TAX_MODELS } from './schemas/tax-regime.schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const COUNTRY = /^[A-Z]{2}$/;

export class TaxRateDto {
  @ApiProperty({ example: 'standard', description: 'Unique within the regime: lower-case letters, digits, - and _' })
  @Transform(trim)
  @Matches(/^[a-z0-9][a-z0-9_-]{0,19}$/, { message: 'code must be 1-20 lower-case letters, digits, - or _' })
  code: string;

  @ApiProperty({ example: 'Standard 5%' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label: string;

  @ApiProperty({ minimum: 0, maximum: 100, description: 'Percent with at most 3 decimals' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  percent: number;

  @ApiProperty()
  @IsBoolean()
  isDefault: boolean;
}

export class ServiceCodeDto {
  @ApiProperty({ example: 'SAC' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  label: string;

  @ApiProperty({ example: '998555' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  value: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  description?: string;
}

export class NumberingDto {
  @ApiProperty({ example: 'INV' })
  @Transform(upperTrim)
  @Matches(/^[A-Z0-9]{1,6}$/, { message: 'prefix must be 1-6 letters or digits' })
  prefix: string;

  @ApiProperty({ example: 'CN' })
  @Transform(upperTrim)
  @Matches(/^[A-Z0-9]{1,6}$/, { message: 'creditPrefix must be 1-6 letters or digits' })
  creditPrefix: string;

  @ApiProperty({ description: 'INV-IN26-000001 instead of INV-26-000001' })
  @IsBoolean()
  includeCountry: boolean;

  @ApiProperty({ enum: [2, 4] })
  @IsIn([2, 4])
  yearDigits: 2 | 4;

  @ApiProperty({ minimum: 4, maximum: 8 })
  @IsInt()
  @Min(4)
  @Max(8)
  sequenceDigits: number;

  @ApiPropertyOptional({ description: 'Longest document number allowed (India: 16)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(40)
  maxLength?: number | null;
}

export class CreateRegimeDto {
  @ApiProperty({ example: 'AE', description: 'ISO 3166-1 alpha-2' })
  @Transform(upperTrim)
  @Matches(COUNTRY, { message: 'country must be a 2-letter ISO code' })
  country: string;

  @ApiPropertyOptional({ example: 'United Arab Emirates', description: 'Derived from the countries list when omitted' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  countryName?: string;

  @ApiProperty({ example: 'VAT' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  taxName: string;

  @ApiProperty({ example: 'Tax Invoice' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  invoiceTitle: string;

  @ApiProperty({ example: 'TRN' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  registrationLabel: string;

  @ApiProperty({ enum: TAX_MODELS })
  @IsIn(TAX_MODELS)
  model: (typeof TAX_MODELS)[number];

  @ApiProperty({ type: [TaxRateDto], description: 'Exactly one default; codes unique' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TaxRateDto)
  rates: TaxRateDto[];

  @ApiPropertyOptional({ type: ServiceCodeDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceCodeDto)
  serviceCode?: ServiceCodeDto | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @ApiProperty({ type: NumberingDto })
  @ValidateNested()
  @Type(() => NumberingDto)
  numbering: NumberingDto;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  invoiceNotes?: string;

  @ApiPropertyOptional({ enum: QR_KINDS, default: 'none' })
  @IsOptional()
  @IsIn(QR_KINDS)
  qr?: (typeof QR_KINDS)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Partial update; the country of a regime cannot change (create a new regime instead), so `country` is rejected. */
export class UpdateRegimeDto extends PartialType(OmitType(CreateRegimeDto, ['country'] as const)) {}

export class CreateSellerDto {
  @ApiProperty({ example: 'AE' })
  @Transform(upperTrim)
  @Matches(COUNTRY, { message: 'country must be a 2-letter ISO code' })
  country: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  legalName: string;

  @ApiProperty({ description: 'TRN / GSTIN / VAT number' })
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  registrationNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ example: '32', description: 'India: 2-digit GST state code' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^(\d{2})?$/, { message: 'stateCode must be 2 digits' })
  stateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @Matches(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be an e-mail address' })
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
  @MaxLength(200)
  website?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  bankDetails?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateSellerDto extends PartialType(CreateSellerDto) {}

export class UpdateTaxSettingsDto {
  @ApiPropertyOptional({ example: 'AE' })
  @IsOptional()
  @Transform(upperTrim)
  @Matches(COUNTRY, { message: 'defaultCountry must be a 2-letter ISO code' })
  defaultCountry?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  defaultRateFallbackPercent?: number;
}

export class TaxPreviewDto {
  @ApiProperty({ example: 'IN' })
  @Transform(upperTrim)
  @Matches(COUNTRY, { message: 'country must be a 2-letter ISO code' })
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(/^(\d{2})?$/, { message: 'stateCode must be 2 digits' })
  stateCode?: string;

  @ApiProperty({ example: 1000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  rateCode?: string;

  @ApiPropertyOptional({ description: 'Defaults to the regime setting' })
  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;
}

/** Optional tax inputs of the enquiry confirm (`POST /admin/stock/enquiry-bookings`). */
export class EnquiryTaxDto {
  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @Transform(upperTrim)
  @Matches(COUNTRY, { message: 'country must be a 2-letter ISO code' })
  country?: string;

  @ApiPropertyOptional({ example: 'gst18' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  rateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  placeOfSupplyState?: string;

  @ApiPropertyOptional({ example: '32' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^(\d{2})?$/, { message: 'placeOfSupplyStateCode must be 2 digits' })
  placeOfSupplyStateCode?: string;
}

/** Optional buyer details of the enquiry confirm; they appear on the invoice. */
export class EnquiryBuyerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  address?: string;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @Transform(upperTrim)
  @Matches(COUNTRY, { message: 'country must be a 2-letter ISO code' })
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(/^(\d{2})?$/, { message: 'stateCode must be 2 digits' })
  stateCode?: string;

  @ApiPropertyOptional({ description: 'Buyer TRN / GSTIN / VAT number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  registrationNumber?: string;
}

export class EmailInvoiceDto {
  @ApiPropertyOptional({ description: 'Defaults to the buyer e-mail' })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  to?: string;
}
