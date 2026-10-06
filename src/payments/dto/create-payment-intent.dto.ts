import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty()
  @IsMongoId()
  bookingId: string;
}
