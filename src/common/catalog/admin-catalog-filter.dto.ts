import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

/** Admin-only list filters shared by the catalog verticals; ignored on public lists. */
export class AdminCatalogFilterDto {
  @ApiPropertyOptional({ description: 'Admin lists only: true = published, false = drafts' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'published must be true or false' })
  published?: boolean;

  @ApiPropertyOptional({ description: 'Admin lists only: true = sample records, false = real records' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'sample must be true or false' })
  sample?: boolean;
}
