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
