import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DATE_PATTERN, EVENT_SORTS, EventSort } from '../events.utils';

const DAY_MESSAGE = 'must be a real date in YYYY-MM-DD format';

export class ListEventsDto {
  @ApiPropertyOptional({
    description: 'Case- and diacritic-insensitive substring over title, venue, city and tags',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Exact city', example: 'Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Category name or slug', example: 'concerts' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    description: 'Events with a session on this UTC day',
    example: '2026-11-14',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: `date ${DAY_MESSAGE}` })
  @IsISO8601({ strict: true })
  date?: string;

  @ApiPropertyOptional({ description: 'Range start (UTC day, inclusive)', example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: `from ${DAY_MESSAGE}` })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Range end (UTC day, inclusive)', example: '2026-11-30' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: `to ${DAY_MESSAGE}` })
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: EVENT_SORTS, default: 'soonest' })
  @IsOptional()
  @IsIn(EVENT_SORTS)
  sort: EventSort = 'soonest';

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @ApiPropertyOptional({ default: 12, minimum: 1, maximum: 48 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit = 12;

  @ApiPropertyOptional({ default: 'AED' })
  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsString()
  @MaxLength(3)
  currency = 'AED';
}
