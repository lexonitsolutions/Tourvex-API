import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ITINERARY_TYPES, ItineraryType, MAX_DEPARTURES, isNotPastDate } from '../cruises.utils';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_URL = /^(\/[^\s]*|https:\/\/[^\s]+)$/;

@ValidatorConstraint({ name: 'isNotPastDeparture', async: false })
export class IsNotPastDepartureConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isNotPastDate(value);
  }

  defaultMessage(): string {
    return 'departures must not contain past dates';
  }
}

export class CruiseMoneyDto {
  @ApiProperty({ example: 1890 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'AED' })
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class CruiseImageDto {
  @ApiProperty({ example: '/images/destination-a.jpg' })
  @IsString()
  @MaxLength(500)
  @Matches(IMAGE_URL, { message: 'url must start with "/" or "https://"' })
  url: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  alt: string;
}

export class CruiseStopDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  @Max(62)
  day: number;

  @ApiProperty({ example: 'Dubai' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  port: string;

  @ApiPropertyOptional({ example: 'United Arab Emirates' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiProperty({ enum: ITINERARY_TYPES })
  @IsIn(ITINERARY_TYPES)
  type: ItineraryType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  description: string;
}

export class CruiseCabinDto {
  @ApiProperty({ example: 'Balcony' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  type: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  description: string;

  @ApiPropertyOptional({ type: CruiseMoneyDto, nullable: true, description: 'Indicative fare per person' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CruiseMoneyDto)
  fromPrice?: CruiseMoneyDto | null;
}

export class CreateCruiseDto {
  @ApiPropertyOptional({ description: 'Generated from the title when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, { message: 'slug must be lowercase letters, numbers and single hyphens' })
  slug?: string;

  @ApiProperty({ example: 'Eight Nights Mediterranean Escape' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  summary?: string;

  @ApiPropertyOptional({ description: 'Paragraphs separated by a blank line' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiProperty({ example: '/images/destination-a.jpg' })
  @IsString()
  @MaxLength(500)
  @Matches(IMAGE_URL, { message: 'coverImage must start with "/" or "https://"' })
  coverImage: string;

  @ApiPropertyOptional({ type: [CruiseImageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CruiseImageDto)
  images?: CruiseImageDto[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cruiseLine: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shipName: string;

  @ApiProperty({ example: 'Istanbul' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  departureCity: string;

  @ApiProperty({ example: 'Türkiye' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  departureCountry: string;

  @ApiProperty({ example: 'Mediterranean' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  region: string;

  @ApiProperty({ minimum: 1, maximum: 60 })
  @IsInt()
  @Min(1)
  @Max(60)
  durationNights: number;

  @ApiPropertyOptional({ description: 'Defaults to durationNights + 1; must equal the itinerary length' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(62)
  durationDays?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'ISO dates (UTC days), not in the past; stored as unique ascending UTC midnights',
    example: ['2026-11-14'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DEPARTURES)
  @IsISO8601({ strict: true }, { each: true })
  @Validate(IsNotPastDepartureConstraint, { each: true })
  departures?: string[];

  @ApiProperty({ type: [CruiseStopDto], description: 'Day-by-day stops: day 1..durationDays, consecutive' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(62)
  @ValidateNested({ each: true })
  @Type(() => CruiseStopDto)
  itinerary: CruiseStopDto[];

  @ApiPropertyOptional({ type: [CruiseCabinDto], description: '2-4 cabin categories' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => CruiseCabinDto)
  cabins?: CruiseCabinDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  highlights?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  inclusions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  exclusions?: string[];

  @ApiPropertyOptional({ description: 'Disclaimer shown on the page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: [String], example: ['Family', 'Luxury'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: CruiseMoneyDto, nullable: true, description: 'Fallback fare when no cabin has one' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CruiseMoneyDto)
  price?: CruiseMoneyDto | null;

  @ApiPropertyOptional({ default: 0, description: 'Used by sort=popular (higher first)' })
  @IsOptional()
  @IsNumber()
  popularity?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isSample?: boolean;
}
