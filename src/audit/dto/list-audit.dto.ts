import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PagingQueryDto } from '../../common/query/paging-query.dto';

export class ListAuditDto extends PagingQueryDto {
  @ApiPropertyOptional({ description: 'Actor local user id or exact email' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actor?: string;

  @ApiPropertyOptional({ example: 'staff' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @ApiPropertyOptional({ example: 'staff.update' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
