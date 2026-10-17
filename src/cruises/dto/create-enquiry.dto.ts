import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCruiseEnquiryDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  fullName: string;

  @ApiProperty()
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: '+971 50 123 4567', description: '6-20 characters: digits, +, - and spaces' })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+\-\s]{6,20}$/, { message: 'phone must be 6-20 characters: digits, +, - and spaces' })
  phone: string;

  @ApiProperty({ minLength: 2, maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  nationality: string;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  adults: number;

  @ApiProperty({ minimum: 0, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  children: number;

  @ApiPropertyOptional({
    description: "ISO date; must be one of the cruise's upcoming departures",
    example: '2026-11-14',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  departureDate?: string;

  @ApiPropertyOptional({ maxLength: 60, example: 'Balcony' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  cabinType?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  cabins?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  specialRequirements?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiProperty({ description: 'Must be true: agreement to be contacted about this enquiry' })
  @IsBoolean()
  @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}
