import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PagingQueryDto } from '../../common/query/paging-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class ListCustomersDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;

  @ApiPropertyOptional({ description: 'true = only people who opted out of marketing' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  marketingOptOut?: boolean;

  @ApiPropertyOptional({ description: 'true = B2B partner accounts only, false = exclude them' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  b2b?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ description: 'Joined at or after (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Joined at or before (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : t)) : value,
  )
  @Matches(/^[a-z0-9][a-z0-9 _-]{0,29}$/, { each: true, message: 'each tag must be 1-30 letters, digits, space, - or _' })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingOptOut?: boolean;
}

export class DeactivateCustomerDto {
  @ApiPropertyOptional({ maxLength: 300, description: 'Recorded in the audit log' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ListPartnersDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: string;
}

const B2B_ROLE_VALUES = ['b2b_owner', 'b2b_manager', 'b2b_agent'] as const;

export class ReviewPartnerDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @ApiPropertyOptional({ maxLength: 1000, description: 'Required when rejecting' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  @MinLength(3)
  reason?: string;

  @ApiPropertyOptional({ enum: B2B_ROLE_VALUES, default: 'b2b_owner' })
  @IsOptional()
  @IsIn(B2B_ROLE_VALUES)
  role?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 365, description: 'Payment terms in days (0 = pay at booking)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  creditTermsDays?: number;

  @ApiPropertyOptional({ description: 'Credit limit in AED' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  creditLimitAed?: number;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ enum: B2B_ROLE_VALUES })
  @IsOptional()
  @IsIn(B2B_ROLE_VALUES)
  role?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  creditTermsDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  creditLimitAed?: number;
}
