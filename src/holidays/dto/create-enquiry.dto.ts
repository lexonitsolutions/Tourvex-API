import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateHolidayEnquiryDto {
  @ApiPropertyOptional({ maxLength: 40, description: 'Optional client reference; generated (HOL-123456) when omitted' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9-]{4,40}$/, { message: 'reference must be 4-40 letters, digits or hyphens' })
  reference?: string;

  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  fullName: string;

  @ApiProperty()
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: '+971 50 123 4567', description: '6-20 characters: digits, +, - and spaces' })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+\-\s]{6,20}$/, { message: 'phone must be 6-20 characters: digits, +, - and spaces' })
  phone: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 1, description: 'Total number of travellers' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  travelers?: number;

  @ApiPropertyOptional({ description: 'Preferred travel date (ISO)', example: '2026-11-14' })
  @IsOptional()
  @IsISO8601({ strict: true })
  travelDate?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Quoted total shown to the traveller' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  totalAmount?: number;

  @ApiPropertyOptional({ minLength: 3, maxLength: 3, default: 'AED', example: 'AED' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Used as the message when `message` is omitted' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ maxLength: 80, example: 'Indian' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  nationality?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  adults?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  departureCity?: string;

  @ApiPropertyOptional({ description: 'Preferred return date (ISO)' })
  @IsOptional() @IsISO8601({ strict: true })
  returnDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  rooms?: number;

  @ApiPropertyOptional({ maxLength: 40, example: '5 star' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  hotelCategory?: string;

  @ApiPropertyOptional({ type: [Number], description: 'One age for every child' })
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(17, { each: true })
  childAges?: number[];

  @ApiPropertyOptional({ maxLength: 2000, description: 'Requested upgrades, transfers, sightseeing and itinerary changes' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  customization?: string;

  @ApiPropertyOptional({ description: 'The traveller asked not to receive offers' })
  @IsOptional()
  @IsBoolean()
  marketingOptOut?: boolean;

  @ApiProperty({ description: 'Must be true: agreement to be contacted about this enquiry' })
  @IsBoolean()
  @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}
