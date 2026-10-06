import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PartnerApplicationStatus } from '../schemas/user.schema';

export class ReviewPartnerApplicationDto {
  @ApiProperty({ enum: [PartnerApplicationStatus.Approved, PartnerApplicationStatus.Rejected] })
  @IsIn([PartnerApplicationStatus.Approved, PartnerApplicationStatus.Rejected])
  decision: PartnerApplicationStatus.Approved | PartnerApplicationStatus.Rejected;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  note?: string;
}
