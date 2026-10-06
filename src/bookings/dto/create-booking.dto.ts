import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  sku: string;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number;

  @ApiPropertyOptional({ description: 'Displayed currency; inventory currency remains authoritative.' })
  @IsOptional()
  @IsString()
  currency?: string;
}
