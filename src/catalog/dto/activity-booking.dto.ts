import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const OPTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class AvailabilityQueryDto {
  @ApiProperty({ example: 'classical-city-tour' })
  @IsString()
  @Matches(OPTION_ID_PATTERN, { message: 'optionId is invalid' })
  optionId: string;

  @ApiProperty({ example: '2026-10' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;
}

/** Item fields shared by quote, add-to-cart and modify (the cart adds `activitySlug`). */
export class QuoteDto {
  @ApiProperty()
  @IsString()
  @Matches(OPTION_ID_PATTERN, { message: 'optionId is invalid' })
  optionId: string;

  @ApiProperty({ example: '2026-10-05' })
  @Matches(ISO_DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(50)
  adults: number;

  @ApiProperty({ minimum: 0, default: 0 })
  @IsInt()
  @Min(0)
  @Max(50)
  children: number;
}

export class QuoteQueryDto {
  @ApiPropertyOptional({ description: 'Indicative display currency for `display.total`.' })
  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsString()
  @MaxLength(3)
  currency?: string;
}
