import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateTicketDto, ListMyTicketsDto, TicketMessageDto } from './dto/tickets.dto';
import { TicketsService } from './tickets.service';

/** Customer API: every route is scoped to the signed-in user's own tickets (someone else's id is a 404). */
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Open a support ticket, optionally linked to one of your bookings' })
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.createForCustomer(user, dto);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: ListMyTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.listForCustomer(user.sub, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.getForCustomer(user.sub, id);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  message(@Param('id') id: string, @Body() dto: TicketMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.customerMessage(user, id, dto.body);
  }

  @Post(':id/close')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.customerClose(user.sub, id);
  }

  @Post(':id/reopen')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  reopen(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.customerReopen(user.sub, id);
  }
}
