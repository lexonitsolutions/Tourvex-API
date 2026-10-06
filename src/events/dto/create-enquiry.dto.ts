import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateEventEnquiryDto {
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

  @ApiProperty({
    example: '+971 50 123 4567',
    description: '6-20 characters: digits, +, - and spaces',
  })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+\-\s]{6,20}$/, {
    message: 'phone must be 6-20 characters: digits, +, - and spaces',
  })
  phone: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  tickets: number;

  @ApiPropertyOptional({ maxLength: 60, example: 'Standard' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  ticketType?: string;

  @ApiPropertyOptional({ description: "Id of one of the event's upcoming sessions" })
  @IsOptional()
  @IsMongoId()
  sessionId?: string;

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
