import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const IMAGE_URL = /^(\/[^\s]+|https:\/\/[^\s]+)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class HolidayMoneyDto {
  @ApiProperty({ example: 1890 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'AED' })
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class HolidayImageDto {
  @ApiProperty({ example: '/images/destination-03.jpg' })
  @IsString()
  @Matches(IMAGE_URL, { message: 'url must be a /path or an https:// URL' })
  url: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  alt: string;
}

export class HolidayItineraryDayDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  day: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ type: [String], description: 'Key activities or moments shown for this itinerary day' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  bulletPoints?: string[];
}

export class HolidayRatingDto {
  @ApiProperty({ minimum: 0, maximum: 5 })
  @IsNumber()
  @Min(0)
  @Max(5)
  average: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  count: number;
}

export class CreateHolidayDto {
  @ApiPropertyOptional({ description: 'Generated from the title when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, { message: 'slug must be lowercase letters, numbers and single hyphens' })
  slug?: string;

  @ApiProperty()
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

  @ApiProperty({ type: [String], example: ['Dubai'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  destinations: string[];

  @ApiProperty({ example: 'United Arab Emirates' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiProperty({ minimum: 0, maximum: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  durationNights: number;

  @ApiPropertyOptional({ description: 'Defaults to durationNights + 1' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(61)
  durationDays?: number;

  @ApiPropertyOptional({ type: HolidayMoneyDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => HolidayMoneyDto)
  price?: HolidayMoneyDto | null;

  @ApiPropertyOptional({ type: HolidayMoneyDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => HolidayMoneyDto)
  salePrice?: HolidayMoneyDto | null;

  @ApiProperty({ type: [HolidayImageDto], description: 'Gallery; the first image is the cover' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HolidayImageDto)
  images: HolidayImageDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  highlights?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  inclusions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  exclusions?: string[];

  @ApiPropertyOptional({ type: [HolidayItineraryDayDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(62)
  @ValidateNested({ each: true })
  @Type(() => HolidayItineraryDayDto)
  itinerary?: HolidayItineraryDayDto[];

  @ApiPropertyOptional({ type: [String], example: ['Family', 'Beach'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  themes?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Collection slugs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  collections?: string[];

  @ApiPropertyOptional({ type: HolidayRatingDto, nullable: true, description: 'Only set from real review data' })
  @IsOptional()
  @ValidateNested()
  @Type(() => HolidayRatingDto)
  rating?: HolidayRatingDto | null;

  @ApiPropertyOptional({ default: 0, description: 'Used by sort=popular (higher first)' })
  @IsOptional()
  @IsNumber()
  popularity?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Allow customers to add this package to the shared cart' })
  @IsOptional()
  @IsBoolean()
  allowAddToCart?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isSample?: boolean;
}
