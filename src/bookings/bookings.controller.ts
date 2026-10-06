import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.create(dto, user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bookings.listForUser(user);
  }

  /** All bookings of one checkout order (confirmation page). Must stay above `:id`. */
  @Get('order/:orderReference')
  findOrder(@Param('orderReference') orderReference: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.listByOrder(orderReference, user);
  }

  @Get(':id')
  find(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.findAccessible(id, user);
  }

  /** The caller's voucher with its QR (inline SVG path data; the QR holds only a random code). */
  @Get(':id/voucher')
  @Header('Cache-Control', 'no-store')
  voucher(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.voucherFor(id, user);
  }

  @Get(':id/invoice.pdf')
  @Header('Cache-Control', 'no-store')
  async invoice(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.bookings.invoicePdfFor(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buffer);
  }

  @Post(':id/cancellation')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.requestCancellation(id, user);
  }
}
