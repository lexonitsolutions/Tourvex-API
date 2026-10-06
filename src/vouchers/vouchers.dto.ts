import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsMongoId, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PagingQueryDto } from '../common/query/paging-query.dto';
import { VOUCHER_STATUSES } from './voucher.schema';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListVouchersDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: VOUCHER_STATUSES })
  @IsOptional()
  @IsIn(VOUCHER_STATUSES)
  status?: (typeof VOUCHER_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Activity slug' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  activity?: string;

  @ApiPropertyOptional({ example: '2026-10-05' })
  @IsOptional()
  @Matches(DAY, { message: 'serviceFrom must be YYYY-MM-DD' })
  serviceFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY, { message: 'serviceTo must be YYYY-MM-DD' })
  serviceTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  redeemedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  redeemedTo?: string;

  @ApiPropertyOptional({ description: 'Staff user id' })
  @IsOptional()
  @IsMongoId()
  redeemedBy?: string;
}

export class VoucherCodeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  code: string;
}

export class VoidVoucherDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}
