import { Injectable } from '@nestjs/common';
import { ClerkTokenVerifier } from '../clerk/clerk-token-verifier.service';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

/**
 * For `@Public()` routes that can enrich the request when the caller happens to be signed in.
 * Reuses the guard's token verification; ANY problem (no header, bad/expired token, inactive
 * account, Clerk unreachable) yields `undefined`, never an error, so anonymous callers are never
 * rejected and no verification detail leaks.
 */
@Injectable()
export class OptionalUserResolver {
  constructor(
    private readonly verifier: ClerkTokenVerifier,
    private readonly users: UsersService,
  ) {}

  /** Local user id for a valid bearer token, otherwise undefined. */
  async resolveUserId(authorization: string | undefined): Promise<string | undefined> {
    const token = this.verifier.extractBearerToken(authorization);
    if (!token || !this.verifier.isConfigured) return undefined;
    try {
      const clerkUserId = await this.verifier.verify(token);
      const identity = await this.users.resolveFromClerk(clerkUserId);
      return identity.status === UserStatus.Active && identity.active !== false
        ? identity.id
        : undefined;
    } catch {
      return undefined;
    }
  }
}
