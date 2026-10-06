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
import { EVENT_CATEGORIES, EventCategory, isNotPastDate, MAX_SESSIONS } from '../events.utils';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_URL = /^(\/[^\s]*|https:\/\/[^\s]+)$/;

@ValidatorConstraint({ name: 'isNotPastSession', async: false })
export class IsNotPastSessionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isNotPastDate(value);
  }

  defaultMessage(): string {
    return 'session start times must not be in the past';
  }
}

export class EventMoneyDto {
  @ApiProperty({ example: 195 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'AED' })
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class EventImageDto {
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

export class EventSessionDto {
  @ApiProperty({
    example: '2026-11-14T18:30:00.000Z',
    description: 'ISO datetime; not before today (UTC)',
  })
  @IsISO8601({ strict: true })
  @Validate(IsNotPastSessionConstraint)
  startsAt: string;

  @ApiPropertyOptional({ example: '2026-11-14T17:30:00.000Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  doorsOpenAt?: string;
}

export class EventTicketTypeDto {
  @ApiProperty({ example: 'Standard' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  type: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  description: string;

  @ApiPropertyOptional({
    type: EventMoneyDto,
    nullable: true,
    description: 'Indicative per-ticket price',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EventMoneyDto)
  price?: EventMoneyDto | null;
}

export class CreateEventDto {
  @ApiPropertyOptional({ description: 'Generated from the title when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, { message: 'slug must be lowercase letters, numbers and single hyphens' })
  slug?: string;

  @ApiProperty({ example: 'Skyline Night Live' })
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

  @ApiPropertyOptional({ type: [EventImageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => EventImageDto)
  images?: EventImageDto[];

  @ApiProperty({ enum: EVENT_CATEGORIES })
  @IsIn(EVENT_CATEGORIES)
  category: EventCategory;

  @ApiProperty({ example: 'Harbour Arena' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  venue: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  venueAddress?: string;

  @ApiProperty({ example: 'Dubai' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 'United Arab Emirates' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number | null;

  @ApiPropertyOptional({
    type: [EventSessionDto],
    description: 'Start times not before today (UTC); max 60',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SESSIONS)
  @ValidateNested({ each: true })
  @Type(() => EventSessionDto)
  sessions?: EventSessionDto[];

  @ApiProperty({ type: [EventTicketTypeDto], description: '2-4 ticket types' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => EventTicketTypeDto)
  ticketTypes: EventTicketTypeDto[];

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

  @ApiPropertyOptional({ example: 'All ages' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ageGuidance?: string;

  @ApiPropertyOptional({ description: 'Disclaimer shown on the page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: [String], example: ['Family friendly', 'Outdoor'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: EventMoneyDto,
    nullable: true,
    description: 'Fallback price when no ticket type has one',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EventMoneyDto)
  price?: EventMoneyDto | null;

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
