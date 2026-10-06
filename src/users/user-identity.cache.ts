import { Injectable } from '@nestjs/common';
import { UserStatus } from './schemas/user.schema';

/** The slice of a local user the auth guard needs on every request. */
export interface ResolvedIdentity {
  id: string;
  clerkUserId: string;
  email: string;
  roles: string[];
  status: UserStatus;
  /** False when staff management deactivated the account (legacy users without the field = true). */
  active: boolean;
  partnerId?: string;
}

interface Entry {
  value: ResolvedIdentity;
  expiresAt: number;
}

/**
 * Short-lived, bounded, per-process cache from Clerk user id to the resolved local user,
 * so a page that makes several API calls does not hit MongoDB/Clerk for each one.
 * Entries are invalidated whenever roles, status or partner approval change via UsersService;
 * in a multi-instance deployment other instances converge within TTL_MS.
 */
@Injectable()
export class UserIdentityCache {
  static readonly TTL_MS = 60_000;
  static readonly MAX_ENTRIES = 5_000;
  private readonly entries = new Map<string, Entry>();

  get(clerkUserId: string, now = Date.now()): ResolvedIdentity | undefined {
    const entry = this.entries.get(clerkUserId);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(clerkUserId);
      return undefined;
    }
    return entry.value;
  }

  set(value: ResolvedIdentity, now = Date.now()): void {
    this.entries.delete(value.clerkUserId);
    if (this.entries.size >= UserIdentityCache.MAX_ENTRIES) {
      // Map iteration order is insertion order: drop the oldest entry.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(value.clerkUserId, { value, expiresAt: now + UserIdentityCache.TTL_MS });
  }

  invalidate(clerkUserId: string | null | undefined): void {
    if (clerkUserId) this.entries.delete(clerkUserId);
  }

  clear(): void {
    this.entries.clear();
  }
}
