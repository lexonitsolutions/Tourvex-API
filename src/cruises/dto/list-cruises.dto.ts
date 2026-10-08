import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { AdminCatalogFilterDto } from '../../common/catalog/admin-catalog-filter.dto';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CRUISE_SORTS, CruiseSort, MONTH_PATTERN } from '../cruises.utils';

export class ListCruisesDto extends AdminCatalogFilterDto {
  @ApiPropertyOptional({
    description: 'Case- and diacritic-insensitive substring over title, ship, line and ports',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Exact departure city', example: 'Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Exact cruise line name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  line?: string;

  @ApiPropertyOptional({ description: 'Exact region', example: 'Mediterranean' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ description: 'Departure month (UTC), YYYY-MM', example: '2026-11' })
  @IsOptional()
  @IsString()
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  minNights?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  maxNights?: number;

  @ApiPropertyOptional({ enum: CRUISE_SORTS, default: 'popular' })
  @IsOptional()
  @IsIn(CRUISE_SORTS)
  sort: CruiseSort = 'popular';

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
