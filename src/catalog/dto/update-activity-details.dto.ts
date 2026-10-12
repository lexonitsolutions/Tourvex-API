import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TRANSFER_TYPES } from '../activity-booking.utils';
import { ISO_DATE_PATTERN, OPTION_ID_PATTERN } from './activity-booking.dto';

const IMAGE_URL = /^(https:\/\/|\/)\S+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const list = () => ({ each: true });

export class MoneyInputDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  amount: number;

  /** Option prices are stored and charged in AED. */
  @IsIn(['AED'])
  currency: string;
}

export class GalleryImageDto {
  @Matches(IMAGE_URL, { message: 'url must be https://... or /images/...' })
  @MaxLength(500)
  url: string;

  @IsString()
  @MaxLength(200)
  alt: string;
}

export class ActivityVideoDto {
  @Matches(/^(https:\/\/|\/videos\/|\/api\/v1\/media\/videos\/)\S+$/, {
    message: 'url must be https://... or a site video path',
  })
  @MaxLength(500)
  url: string;
}

export class LocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address: string;

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
}

export class ActivityItineraryItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  duration?: string;

  @IsOptional()
  @Matches(IMAGE_URL, { message: 'imageUrl must be https://... or /images/...' })
  @MaxLength(500)
  imageUrl?: string;
}

export class ActivityFaqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  answer: string;
}

export class ActivityContentSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(500, list())
  items?: string[];
}

export class ActivityOptionDto {
  @Matches(OPTION_ID_PATTERN, { message: 'id must be lower-case letters, digits and dashes' })
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @IsIn(TRANSFER_TYPES)
  transferType: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  startTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  durationLabel?: string;

  @ValidateNested()
  @Type(() => MoneyInputDto)
  adultPrice: MoneyInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  childPrice?: MoneyInputDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  childAgeRange?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  minPax: number;

  @IsInt()
  @Min(1)
  @Max(100)
  maxPax: number;

  @IsBoolean()
  pickupRequired: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  freeCancellationHours?: number | null;

  @IsBoolean()
  refundable: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  @Min(0, { each: true })
  @Max(6, { each: true })
  operatingWeekdays: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(366)
  @Matches(ISO_DATE_PATTERN, { each: true, message: 'blackoutDates must be YYYY-MM-DD' })
  blackoutDates?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  dailyCapacity?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  cutoffHours?: number;
}

/** Whitelist of detail fields staff may edit. `options` and `gallery` are replaced wholesale. */
export class UpdateActivityDetailsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, { message: 'slug must be lowercase letters, numbers and single hyphens' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString(list())
  @IsNotEmpty(list())
  destinations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString(list())
  @IsNotEmpty(list())
  categories?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  price?: MoneyInputDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  salePrice?: MoneyInputDto | null;

  @IsOptional()
  @IsString()
  @Matches(IMAGE_URL, { message: 'imageUrl must be https://... or /images/...' })
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsBoolean()
  isSample?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => GalleryImageDto)
  gallery?: GalleryImageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ActivityVideoDto)
  heroVideo?: ActivityVideoDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  operatingHours?: string;

  @IsOptional()
  @IsBoolean()
  instantConfirmation?: boolean;

  @IsOptional()
  @IsBoolean()
  mobileVoucher?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  freeCancellationHours?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString(list())
  @MaxLength(60, list())
  languages?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(500, list())
  highlights?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(500, list())
  inclusions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(500, list())
  exclusions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(500, list())
  howToRedeem?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(800, list())
  importantInfo?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(500, list())
  whatToBring?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString(list())
  @MaxLength(800, list())
  cancellationPolicy?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ActivityItineraryItemDto)
  itinerary?: ActivityItineraryItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ActivityFaqDto)
  faqs?: ActivityFaqDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ActivityContentSectionDto)
  contentSections?: ActivityContentSectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  duration?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ActivityOptionDto)
  options?: ActivityOptionDto[];

  /** Omitted on admin edits (real data => false); the seed/import sets it explicitly. */
  @IsOptional()
  @IsBoolean()
  detailsAreSample?: boolean;
}
