import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ENQUIRY_STATUSES, EnquiryStatus } from '../visas.utils';

export class UpdateVisaEnquiryStatusDto {
  @ApiProperty({ enum: ENQUIRY_STATUSES })
  @IsIn(ENQUIRY_STATUSES)
  status: EnquiryStatus;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Internal note' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListVisaEnquiriesDto {
  @ApiPropertyOptional({ enum: ENQUIRY_STATUSES })
  @IsOptional()
  @IsIn(ENQUIRY_STATUSES)
  status?: EnquiryStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
