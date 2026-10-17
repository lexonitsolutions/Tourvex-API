import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePartnerApplicationDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Desert Routes Travel LLC' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  companyName: string;

  @ApiProperty({ maxLength: 80, example: 'Travel Agency' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  businessType: string;

  @ApiProperty({ maxLength: 80, example: 'Travel Agencies' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  partnershipCategory: string;

  @ApiProperty({ maxLength: 80, example: 'United Arab Emirates' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  country: string;

  @ApiProperty({ maxLength: 80, example: 'Dubai' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  city: string;

  @ApiProperty({ maxLength: 1200 })
  @Transform(trim)
  @IsString()
  @Length(20, 1200)
  businessDescription: string;

  @ApiPropertyOptional({ minLength: 6, maxLength: 20, example: '+971 4 123 4567' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(6, 20)
  @Matches(/^[0-9+\- ]+$/, { message: 'phone may contain only digits, +, - and spaces' })
  phone?: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  @IsOptional()
  @Transform(trim)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  website?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;
}
