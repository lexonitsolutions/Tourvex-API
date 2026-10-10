import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, Matches } from 'class-validator';
import { RANGE_PRESETS } from './reports-rules';

const DAY_OR_ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

export class ReportRangeDto {
  @ApiPropertyOptional({ enum: RANGE_PRESETS, default: '30d', description: 'Last N Dubai days including today, or year to date. Ignored when from/to are given.' })
  @IsOptional()
  @IsIn([...RANGE_PRESETS])
  range?: (typeof RANGE_PRESETS)[number];

  @ApiPropertyOptional({ example: '2026-09-01', description: 'First day (YYYY-MM-DD or ISO instant, read as an Asia/Dubai day). With `to`, at most 366 days.' })
  @IsOptional()
  @Matches(DAY_OR_ISO, { message: 'from must be YYYY-MM-DD or an ISO date' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Last day inclusive; default today' })
  @IsOptional()
  @Matches(DAY_OR_ISO, { message: 'to must be YYYY-MM-DD or an ISO date' })
  to?: string;
}

export const MARGIN_GROUPS = ['product', 'day', 'month', 'type'] as const;
export const MARGIN_PRODUCT_TYPES = ['activity', 'holiday', 'cruise', 'event', 'visa', 'transfer', 'hotel', 'flight'] as const;

export class MarginReportDto extends ReportRangeDto {
  @ApiPropertyOptional({ enum: MARGIN_GROUPS, default: 'product' })
  @IsOptional()
  @IsIn([...MARGIN_GROUPS])
  groupBy?: (typeof MARGIN_GROUPS)[number];

  @ApiPropertyOptional({ enum: MARGIN_PRODUCT_TYPES, description: 'Only bookings of this service type' })
  @IsOptional()
  @IsIn([...MARGIN_PRODUCT_TYPES])
  productType?: (typeof MARGIN_PRODUCT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Only bookings of items that were purchased from this supplier (received or paid purchase lines)' })
  @IsOptional()
  @IsMongoId()
  supplierId?: string;
}
