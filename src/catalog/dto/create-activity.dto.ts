import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDefined, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { UpdateActivityDetailsDto } from './update-activity-details.dto';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateActivityDto extends OmitType(UpdateActivityDetailsDto, ['title', 'destinations'] as const) {
  @ApiProperty()
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare title: string;

  @ApiPropertyOptional({ description: 'Generated from the title when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, { message: 'slug must be lowercase letters, numbers and single hyphens' })
  declare slug?: string;

  @ApiProperty({ type: [String] })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  declare destinations: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  declare published?: boolean;
}
