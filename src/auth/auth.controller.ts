import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { UserProfile, UsersService } from '../users/users.service';

/**
 * Sign-up, sign-in, refresh and sign-out are handled by Clerk on the website.
 * This controller only exposes the local profile of the Clerk-authenticated caller.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.users.getProfile(user.sub);
  }
}
