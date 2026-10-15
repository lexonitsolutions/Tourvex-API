import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VISA_ENTRIES, VISA_KINDS, VisaEntries, VisaKind } from '../visas.utils';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class VisaMoneyDto {
  @ApiProperty({ example: 349 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'AED' })
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class VisaProcessingOptionDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/) id: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @MaxLength(100) estimatedTime: string;
  @IsOptional() @ValidateNested() @Type(() => VisaMoneyDto) fee?: VisaMoneyDto | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) benefits?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class VisaStepDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description: string;
}

export class VisaFaqDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  question: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer: string;
}

export class VisaGalleryImageDto {
  @ApiProperty({ example: '/api/v1/media/images/uae-dubai.webp' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/^(https:\/\/|\/images\/|\/api\/v1\/media\/images\/)\S+$/, {
    message: 'gallery image url must be an https URL or a supported site image path',
  })
  url: string;

  @ApiPropertyOptional({ example: 'Dubai skyline at sunset' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string;
}

export class CreateVisaDto {
  @ApiPropertyOptional({ description: 'Generated from the title when omitted', example: 'turkiye-evisa' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, { message: 'slug must be lowercase letters, numbers and single hyphens' })
  slug?: string;

  @ApiProperty({ example: 'Türkiye' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2, lowercase', example: 'tr' })
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'countryCode must be two lowercase letters' })
  countryCode: string;

  @ApiProperty({ example: 'Türkiye e-Visa' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ enum: VISA_KINDS })
  @IsIn(VISA_KINDS)
  kind: VisaKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  summary?: string;

  @ApiPropertyOptional({ description: 'Paragraphs separated by a blank line' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional({ type: VisaMoneyDto, nullable: true, description: 'Our service fee, not the government fee' })
  @IsOptional()
  @ValidateNested()
  @Type(() => VisaMoneyDto)
  startingPrice?: VisaMoneyDto | null;

  @ApiPropertyOptional({ type: VisaMoneyDto }) @IsOptional() @ValidateNested() @Type(() => VisaMoneyDto) adultPrice?: VisaMoneyDto | null;
  @ApiPropertyOptional({ type: VisaMoneyDto }) @IsOptional() @ValidateNested() @Type(() => VisaMoneyDto) minorPrice?: VisaMoneyDto | null;
  @ApiPropertyOptional({ type: VisaMoneyDto }) @IsOptional() @ValidateNested() @Type(() => VisaMoneyDto) serviceCharge?: VisaMoneyDto | null;
  @ApiPropertyOptional({ type: [VisaProcessingOptionDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => VisaProcessingOptionDto) processingOptions?: VisaProcessingOptionDto[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(300) @Matches(/^[A-Z]{2}$/, { each: true }) eligibleNationalities?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(300) @Matches(/^[A-Z]{2}$/, { each: true }) eligibleResidences?: string[];
  @ApiPropertyOptional({ default: 17 }) @IsOptional() @IsNumber() @Min(0) minorMaxAge?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) visaExpertWhatsapp?: string;

  @ApiProperty({ example: '3-5 working days' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  processing: string;

  @ApiProperty({ example: 'Up to 30 days' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  validity: string;

  @ApiPropertyOptional({ enum: VISA_ENTRIES, default: 'varies' })
  @IsOptional()
  @IsIn(VISA_ENTRIES)
  entries?: VisaEntries;

  @ApiPropertyOptional({ example: 'Up to 30 days per visit' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  stay?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  highlights?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(400, { each: true })
  requirements?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(400, { each: true })
  documents?: string[];

  @ApiPropertyOptional({ type: [VisaStepDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => VisaStepDto)
  steps?: VisaStepDto[];

  @ApiPropertyOptional({ type: [VisaFaqDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VisaFaqDto)
  faqs?: VisaFaqDto[];

  @ApiPropertyOptional({ type: [VisaGalleryImageDto], description: 'Famous tourist places shown on the visa detail page' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => VisaGalleryImageDto)
  gallery?: VisaGalleryImageDto[];

  @ApiPropertyOptional({ description: 'Short disclaimer shown on the page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: [String], description: 'Section slugs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  sections?: string[];

  @ApiPropertyOptional({ default: 0, description: 'Used by sort=popular (higher first)' })
  @IsOptional()
  @IsNumber()
  popularity?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Allow this visa service to be added to the cart' })
  @IsOptional()
  @IsBoolean()
  allowAddToCart?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isSample?: boolean;
}
