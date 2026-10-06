import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { HREF_PATTERN, LOGO_PATTERN, PARTNER_PLACEMENTS, PartnerPlacement } from '../partners.utils';

export class CreatePartnerDto {
  @ApiProperty({ minLength: 2, maxLength: 80 })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ nullable: true, description: '`/images/...` or `https://...`' })
  @IsOptional()
  @IsString()
  @Matches(LOGO_PATTERN, { message: 'logo must start with /images/ or https://' })
  logo?: string | null;

  @ApiPropertyOptional({ nullable: true, description: '`https://...` only' })
  @IsOptional()
  @IsString()
  @Matches(HREF_PATTERN, { message: 'href must be an https:// URL' })
  href?: string | null;

  @ApiProperty({ minLength: 2, maxLength: 40 })
  @IsString()
  @Length(2, 40)
  category: string;

  @ApiPropertyOptional({ enum: PARTNER_PLACEMENTS, isArray: true, default: PARTNER_PLACEMENTS })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PARTNER_PLACEMENTS, { each: true })
  placements?: PartnerPlacement[];

  @ApiPropertyOptional({ minimum: 0, maximum: 999, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
