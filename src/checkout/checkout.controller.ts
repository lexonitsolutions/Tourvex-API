import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { CheckoutService } from './checkout.service';
import {
  AdditionalDto,
  ApplyPromoDto,
  CartItemDto,
  CartQueryDto,
  CustomerDto,
  PickupDto,
  UpdatePromoDto,
  UpsertPromoDto,
} from './dto/checkout.dto';
import { PromosService } from './promos.service';

/**
 * Every route here requires a Clerk bearer token (the global guard; nothing is @Public).
 * `GET /checkout/*` is deliberately NOT on the currency interceptor allow-list: amounts are AED,
 * with an indicative `pricing.display` when `?currency=` is sent.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly promos: PromosService,
  ) {}

  // ----- staff: promo codes (static paths, kept above the parameterised ones)

  @Roles(Role.Admin, Role.SuperAdmin, Role.Content)
  @Get('promos')
  listPromos() {
    return this.promos.list();
  }

  @Roles(Role.Admin, Role.SuperAdmin, Role.Content)
  @Post('promos')
  createPromo(@Body() dto: UpsertPromoDto) {
    return this.promos.create(dto);
  }

  @Roles(Role.Admin, Role.SuperAdmin, Role.Content)
  @Patch('promos/:id')
  updatePromo(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePromoDto) {
    return this.promos.update(id, dto);
  }

  @Roles(Role.Admin, Role.SuperAdmin, Role.Content)
  @Delete('promos/:id')
  removePromo(@Param('id', ParseObjectIdPipe) id: string) {
    return this.promos.remove(id);
  }

  // ----- the cart

  @Get('cart')
  @ApiOperation({ summary: 'Current cart (session) or the empty shape; reports expired items once' })
  cart(@CurrentUser() user: AuthenticatedUser, @Query() query: CartQueryDto) {
    return this.checkout.getCart(user, query.currency);
  }

  @Get('cart/status')
  @ApiOperation({ summary: 'Status of the latest cart; poll after a Stripe redirect' })
  cartStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.checkout.getCartStatus(user);
  }

  @Post('cart/items')
  @ApiOperation({ summary: 'Add an item; the same option + date replaces that item' })
  addItem(@Body() dto: CartItemDto, @CurrentUser() user: AuthenticatedUser, @Query() query: CartQueryDto) {
    return this.checkout.addItem(user, dto, query.currency);
  }

  @Patch('cart/customer')
  setCustomer(@Body() dto: CustomerDto, @CurrentUser() user: AuthenticatedUser, @Query() query: CartQueryDto) {
    return this.checkout.setCustomer(user, dto, query.currency);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('cart/promo')
  applyPromo(@Body() dto: ApplyPromoDto, @CurrentUser() user: AuthenticatedUser, @Query() query: CartQueryDto) {
    return this.checkout.applyPromo(user, dto, query.currency);
  }

  @Delete('cart/promo')
  removeCartPromo(@CurrentUser() user: AuthenticatedUser, @Query() query: CartQueryDto) {
    return this.checkout.removePromo(user, query.currency);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('cart/pay')
  @ApiOperation({ summary: 'Create the order and start payment (idempotent)' })
  pay(@CurrentUser() user: AuthenticatedUser) {
    return this.checkout.pay(user);
  }

  @Patch('cart/items/:itemId')
  modifyItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CartItemDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CartQueryDto,
  ) {
    return this.checkout.modifyItem(user, itemId, dto, query.currency);
  }

  @Delete('cart/items/:itemId')
  removeItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CartQueryDto,
  ) {
    return this.checkout.removeItem(user, itemId, query.currency);
  }

  @Patch('cart/items/:itemId/pickup')
  setPickup(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: PickupDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CartQueryDto,
  ) {
    return this.checkout.setPickup(user, itemId, dto, query.currency);
  }

  @Patch('cart/items/:itemId/additional')
  setAdditional(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: AdditionalDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CartQueryDto,
  ) {
    return this.checkout.setAdditional(user, itemId, dto, query.currency);
  }

  // ----- by id (post-payment redirect)

  @Get('sessions/:id')
  session(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CartQueryDto,
  ) {
    return this.checkout.getSession(user, id, query.currency);
  }

  @Get('sessions/:id/status')
  sessionStatus(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.checkout.getSessionStatus(user, id);
  }
}
