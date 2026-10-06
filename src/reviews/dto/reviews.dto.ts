import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { REVIEW_STATUSES } from '../schemas/review.schema';

export class ListReviewsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withImages?: boolean;

  @ApiPropertyOptional({ enum: ['top', 'recent'], default: 'recent' })
  @IsOptional()
  @IsIn(['top', 'recent'])
  sort: 'top' | 'recent' = 'recent';

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;

  /** Accepted so a shared `?currency=` query never fails validation; reviews carry no money. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;
}

export class CreateReviewDto {
  @ApiProperty({ example: 'TVX-2026-1A2B3C4D' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{6,40}$/, { message: 'bookingReference is invalid' })
  bookingReference: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  body: string;
}

export class ModerateReviewDto {
  @ApiProperty({ enum: ['published', 'rejected'] })
  @IsIn(['published', 'rejected'])
  status: 'published' | 'rejected';
}

export class ListReviewsAdminDto {
  @ApiPropertyOptional({ enum: REVIEW_STATUSES, default: 'pending' })
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status: (typeof REVIEW_STATUSES)[number] = 'pending';

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
