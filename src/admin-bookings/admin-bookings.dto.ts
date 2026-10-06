import { ApiPropertyOptional } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BOOKING_STATUS_VALUES } from './booking-view';
import { PagingQueryDto } from '../common/query/paging-query.dto';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const PAYMENT_STATUS_VALUES = ['unpaid', 'paid', 'partially_refunded', 'refunded'] as const;
export const REFUND_CHOICES = ['policy', 'full', 'none', 'custom'] as const;
export const SERVICE_TYPE_VALUES = ['flight', 'hotel', 'activity', 'visa', 'transfer'] as const;

export class ListBookingsDto extends PagingQueryDto {
  @ApiPropertyOptional({ description: 'One status or a comma-separated list', example: 'confirmed,cancelled' })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${BOOKING_STATUS_VALUES.join('|')})(,(${BOOKING_STATUS_VALUES.join('|')}))*$`), {
    message: `status must be one or more of: ${BOOKING_STATUS_VALUES.join(', ')}`,
  })
  status?: string;

  @ApiPropertyOptional({ enum: SERVICE_TYPE_VALUES })
  @IsOptional()
  @IsIn(SERVICE_TYPE_VALUES)
  serviceType?: string;

  @ApiPropertyOptional({ description: 'Activity slug' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  activity?: string;

  @ApiPropertyOptional({ enum: PAYMENT_STATUS_VALUES })
  @IsOptional()
  @IsIn(PAYMENT_STATUS_VALUES)
  paymentStatus?: string;

  @ApiPropertyOptional({ description: 'Created from (ISO date or datetime)' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @ApiPropertyOptional({ example: '2026-10-05', description: 'Service day from (inclusive)' })
  @IsOptional()
  @Matches(DAY, { message: 'serviceFrom must be YYYY-MM-DD' })
  serviceFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY, { message: 'serviceTo must be YYYY-MM-DD' })
  serviceTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderReference?: string;
}

export class ListOrdersDto extends PagingQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUS_VALUES })
  @IsOptional()
  @IsIn(BOOKING_STATUS_VALUES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

const Reason = (max = 300) => applyDecorators(Transform(trim), IsString(), IsNotEmpty(), MaxLength(max));

export class ConfirmBookingDto {
  @ApiPropertyOptional({ description: 'Reference of the offline payment being recorded (bank transfer, cash receipt...)' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  paymentReference: string;
}

export class CancelBookingDto {
  @Reason()
  reason: string;

  @ApiPropertyOptional({
    enum: REFUND_CHOICES,
    default: 'policy',
    description: 'policy = full refund only before the free-cancellation deadline; a refund needs bookings.refund',
  })
  @IsOptional()
  @IsIn(REFUND_CHOICES)
  refund?: (typeof REFUND_CHOICES)[number];

  @ApiPropertyOptional({ description: 'Required when refund is custom (AED)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  refundAmount?: number;
}

export class RefundBookingDto {
  @ApiPropertyOptional({ description: 'AED, at most what is still refundable' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amount: number;

  @Reason()
  reason: string;

  @ApiPropertyOptional({ description: 'Repeating a request with the same key returns the first refund' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,64}$/, { message: 'idempotencyKey must be 8-64 characters (letters, digits . _ : -)' })
  idempotencyKey?: string;
}

export class RejectCancellationDto {
  @Reason()
  reason: string;
}

export class ApproveCancellationDto {
  @ApiPropertyOptional({ enum: REFUND_CHOICES, default: 'policy' })
  @IsOptional()
  @IsIn(REFUND_CHOICES)
  refund?: (typeof REFUND_CHOICES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  refundAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ChangeServiceDateDto {
  @Matches(DAY, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @Reason()
  reason: string;
}
