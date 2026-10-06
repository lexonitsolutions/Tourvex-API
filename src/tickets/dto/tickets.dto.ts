import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PagingQueryDto } from '../../common/query/paging-query.dto';
import { MESSAGE_MAX_LENGTH, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../tickets.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @ApiProperty({ minLength: 3, maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  subject: string;

  @ApiProperty({ enum: TICKET_CATEGORIES })
  @IsIn(TICKET_CATEGORIES)
  category: string;

  @ApiProperty({ maxLength: MESSAGE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({ description: 'One of your own bookings (id from GET /bookings)' })
  @IsOptional()
  @IsMongoId()
  bookingId?: string;
}

export class TicketMessageDto {
  @ApiProperty({ maxLength: MESSAGE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;
}

export class ListMyTicketsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Matches(/^\d{1,5}$/)
  page?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Matches(/^\d{1,3}$/)
  limit?: string;
}

export class ListTicketsDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'unassigned', 'all', 'overdue'], default: 'all' })
  @IsOptional()
  @IsIn(['mine', 'unassigned', 'all', 'overdue'])
  tab?: string;

  @ApiPropertyOptional({ enum: TICKET_STATUSES, description: 'Comma separated' })
  @IsOptional()
  @Matches(new RegExp(`^(${TICKET_STATUSES.join('|')})(,(${TICKET_STATUSES.join('|')}))*$`), {
    message: 'status must be a comma separated list of valid statuses',
  })
  status?: string;

  @ApiPropertyOptional({ enum: TICKET_PRIORITIES })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ enum: TICKET_CATEGORIES })
  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ description: 'Assignee id' })
  @IsOptional()
  @IsMongoId()
  assignee?: string;

  @ApiPropertyOptional({ description: 'Created at or after (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Created at or before (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class StaffReplyDto {
  @ApiProperty({ maxLength: MESSAGE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({ description: 'true = internal note, never shown to the customer' })
  @IsOptional()
  @IsBoolean()
  internal?: boolean;

  @ApiPropertyOptional({ enum: ['open', 'pending', 'resolved'], description: 'Status after a public reply (default pending)' })
  @IsOptional()
  @IsIn(['open', 'pending', 'resolved'])
  setStatus?: string;
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ enum: TICKET_CATEGORIES })
  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: string;
}

export class AssignTicketDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsMongoId()
  assigneeId?: string | null;
}

export class ChangeTicketStatusDto {
  @ApiProperty({ enum: TICKET_STATUSES })
  @IsIn(TICKET_STATUSES)
  status: string;
}

export class BulkCloseTicketsDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  ids: string[];
}
