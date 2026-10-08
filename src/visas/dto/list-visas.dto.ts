import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { AdminCatalogFilterDto } from '../../common/catalog/admin-catalog-filter.dto';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { VISA_KINDS, VISA_SORTS, VisaKind, VisaSort } from '../visas.utils';

export class ListVisasDto extends AdminCatalogFilterDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring over country and title' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: VISA_KINDS })
  @IsOptional()
  @IsIn(VISA_KINDS)
  kind?: VisaKind;

  @ApiPropertyOptional({ description: 'Exact country name', example: 'Türkiye' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ enum: VISA_SORTS, default: 'popular' })
  @IsOptional()
  @IsIn(VISA_SORTS)
  sort: VisaSort = 'popular';

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit = 24;

  @ApiPropertyOptional({ default: 'AED' })
  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsString()
  @MaxLength(3)
  currency = 'AED';
}
