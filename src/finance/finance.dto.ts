import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class FinanceRangeDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'First day (Asia/Dubai); default 29 days before "to"' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Last day inclusive; default today (Asia/Dubai). At most 366 days.' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ enum: ['daily', 'lines'], default: 'daily', description: 'Reconciliation CSV: one row per day or per payment/refund' })
  @IsOptional()
  @IsIn(['daily', 'lines'])
  view?: 'daily' | 'lines';
}

export class GenerateInvoiceDto {
  @IsMongoId()
  bookingId: string;
}
