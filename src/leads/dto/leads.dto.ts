import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagingQueryDto } from '../../common/query/paging-query.dto';
import {
  CONTACT_CHANNELS,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOST_REASONS,
} from '../leads.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** `POST /contact` (public). `website` is a honeypot: real visitors never see or fill it. */
export class CreateContactDto {
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

  @ApiPropertyOptional({ description: '6-20 characters: digits, +, - and spaces' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+\-\s]{6,20}$/, { message: 'phone must be 6-20 characters: digits, +, - and spaces' })
  phone?: string;

  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  subject: string;

  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @Length(5, 2000)
  message: string;

  @ApiPropertyOptional({ description: 'Activity the visitor came from (prefill from ?activity=<slug>)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,119}$/, { message: 'activitySlug must be a slug' })
  activitySlug?: string;

  @ApiProperty({ description: 'Must be true: agreement to be contacted' })
  @IsBoolean()
  @Equals(true, { message: 'consent must be true' })
  consent: boolean;

  @ApiPropertyOptional({ description: 'Honeypot: leave empty' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

/** `POST /catalog/activities/:slug/enquiries` (public). */
export class CreateActivityEnquiryDto {
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

  @ApiProperty({ description: '6-20 characters: digits, +, - and spaces' })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+\-\s]{6,20}$/, { message: 'phone must be 6-20 characters: digits, +, - and spaces' })
  phone: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  guests?: number;

  @ApiPropertyOptional({ example: '2026-11-14' })
  @IsOptional()
  @IsISO8601({ strict: true })
  preferredDate?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiProperty()
  @IsBoolean()
  @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}

export class ListLeadsDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: LEAD_SOURCES, description: 'Comma separated' })
  @IsOptional()
  @Matches(new RegExp(`^(${LEAD_SOURCES.join('|')})(,(${LEAD_SOURCES.join('|')}))*$`), {
    message: 'source must be a comma separated list of valid sources',
  })
  source?: string;

  @ApiPropertyOptional({ enum: LEAD_STATUSES, description: 'Comma separated' })
  @IsOptional()
  @Matches(new RegExp(`^(${LEAD_STATUSES.join('|')})(,(${LEAD_STATUSES.join('|')}))*$`), {
    message: 'status must be a comma separated list of valid statuses',
  })
  status?: string;

  @ApiPropertyOptional({ description: 'Owner id, `unassigned` or `me`' })
  @IsOptional()
  @Matches(/^([a-f0-9]{24}|unassigned|me)$/i, { message: 'owner must be an id, unassigned or me' })
  owner?: string;

  @ApiPropertyOptional({ enum: LEAD_PRIORITIES })
  @IsOptional()
  @IsIn(LEAD_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ enum: ['due', 'overdue', 'today', 'none'] })
  @IsOptional()
  @IsIn(['due', 'overdue', 'today', 'none'])
  followUp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, created at or after' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, created at or before' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class UpdateLeadDto {
  @ApiPropertyOptional({ enum: LEAD_PRIORITIES })
  @IsOptional()
  @IsIn(LEAD_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : t)) : value,
  )
  @Matches(/^[a-z0-9][a-z0-9 _-]{0,29}$/, { each: true, message: 'each tag must be 1-30 letters, digits, space, - or _' })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Value estimate in AED; null clears it' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  valueAed?: number | null;
}

export class AssignLeadDto {
  @ApiProperty({ nullable: true, description: 'Staff user id, or null to unassign' })
  @IsOptional()
  @IsMongoId()
  ownerId?: string | null;
}

export class ChangeLeadStatusDto {
  @ApiProperty({ enum: LEAD_STATUSES })
  @IsIn(LEAD_STATUSES)
  status: string;

  @ApiPropertyOptional({ enum: LOST_REASONS, description: 'Required when status is lost' })
  @IsOptional()
  @IsIn(LOST_REASONS)
  lostReason?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class FollowUpDto {
  @ApiProperty({ nullable: true, description: 'ISO 8601 date-time, or null to clear' })
  @IsOptional()
  @IsISO8601()
  at?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class LogContactDto {
  @ApiProperty({ enum: CONTACT_CHANNELS })
  @IsIn(CONTACT_CHANNELS)
  channel: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BulkAssignDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  ids: string[];

  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsMongoId()
  ownerId?: string | null;
}

export class BulkStatusDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  ids: string[];

  @ApiProperty({ enum: LEAD_STATUSES })
  @IsIn(LEAD_STATUSES)
  status: string;

  @ApiPropertyOptional({ enum: LOST_REASONS })
  @IsOptional()
  @IsIn(LOST_REASONS)
  lostReason?: string;
}
