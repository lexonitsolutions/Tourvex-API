import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PARTNER_PLACEMENTS, PartnerPlacement } from '../partners.utils';

export class ListPartnersDto {
  @ApiPropertyOptional({ enum: PARTNER_PLACEMENTS })
  @IsOptional()
  @IsIn(PARTNER_PLACEMENTS)
  placement?: PartnerPlacement;

  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 48 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit = 24;
}
