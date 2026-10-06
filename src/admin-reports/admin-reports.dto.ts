import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
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
