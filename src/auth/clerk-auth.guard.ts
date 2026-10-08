import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClerkTokenVerifier, UNAUTHORIZED_MESSAGE } from '../clerk/clerk-token-verifier.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { acceptsDevAuth, DEV_AUTH_CLERK_ID, DEV_AUTH_EMAIL } from './dev-auth';

/**
 * Global guard: trusts Clerk session tokens (`Authorization: Bearer <token>`) and maps them to the
 * LOCAL user, whose id/roles/partner are what the rest of the API authorizes against.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: ClerkTokenVerifier,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.verifier.extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);

    // Local development sign-in (see auth/dev-auth.ts): never true in production or from another machine.
    const isDevSession = acceptsDevAuth(
      { nodeEnv: this.config.get<string>('NODE_ENV'), enabled: this.config.get<string>('DEV_AUTH_ENABLED') },
      token,
      request.socket?.remoteAddress,
    );
    if (isDevSession) await this.users.ensureDevAdmin(DEV_AUTH_CLERK_ID, DEV_AUTH_EMAIL);
    else if (!this.verifier.isConfigured) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);

    const clerkUserId = isDevSession ? DEV_AUTH_CLERK_ID : await this.verifier.verify(token);
    const identity = await this.users.resolveFromClerk(clerkUserId);
    if (identity.status !== UserStatus.Active || identity.active === false) {
      throw new ForbiddenException('Account is not active');
    }

    request.user = {
      sub: identity.id,
      email: identity.email,
      roles: identity.roles,
      partnerId: identity.partnerId,
      clerkUserId: identity.clerkUserId,
    };
    return true;
  }
}
