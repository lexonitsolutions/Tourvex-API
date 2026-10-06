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
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isNotPastDate } from '../visas.utils';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

@ValidatorConstraint({ name: 'isNotPastDate', async: false })
export class IsNotPastDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isNotPastDate(value);
  }

  defaultMessage(): string {
    return 'travelDate must not be in the past';
  }
}

export class CreateVisaEnquiryDto {
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

  @ApiProperty({ minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  travellers: number;

  @ApiPropertyOptional({ description: 'ISO date, not in the past', example: '2027-01-15' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Validate(IsNotPastDateConstraint)
  travelDate?: string;

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
