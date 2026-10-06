import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PagingQueryDto } from '../../common/query/paging-query.dto';
import { INVOICE_KINDS, InvoiceStatus } from './schemas/invoice.schema';

export class ListInvoicesDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsIn(Object.values(InvoiceStatus))
  status?: InvoiceStatus;

  @ApiPropertyOptional({ enum: INVOICE_KINDS })
  @IsOptional()
  @IsIn(INVOICE_KINDS)
  kind?: (typeof INVOICE_KINDS)[number];

  @ApiPropertyOptional({ description: 'Created from (ISO date or datetime)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;
}
