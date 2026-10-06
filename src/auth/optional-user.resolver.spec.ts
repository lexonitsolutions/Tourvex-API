import { UnauthorizedException } from '@nestjs/common';
import { ClerkTokenVerifier } from '../clerk/clerk-token-verifier.service';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { OptionalUserResolver } from './optional-user.resolver';

describe('OptionalUserResolver', () => {
  let verifier: {
    isConfigured: boolean;
    extractBearerToken: jest.Mock;
    verify: jest.Mock;
  };
  let users: { resolveFromClerk: jest.Mock };
  let resolver: OptionalUserResolver;

  beforeEach(() => {
    verifier = {
      isConfigured: true,
      extractBearerToken: jest.fn((header?: string) => header?.replace(/^Bearer /, '')),
      verify: jest.fn(),
    };
    users = { resolveFromClerk: jest.fn() };
    resolver = new OptionalUserResolver(
      verifier as unknown as ClerkTokenVerifier,
      users as unknown as UsersService,
    );
  });

  it('returns undefined without a header and never verifies', async () => {
    verifier.extractBearerToken.mockReturnValue(undefined);
    await expect(resolver.resolveUserId(undefined)).resolves.toBeUndefined();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('swallows verification failures', async () => {
    verifier.verify.mockRejectedValue(new UnauthorizedException('Authentication required'));
    await expect(resolver.resolveUserId('Bearer bad')).resolves.toBeUndefined();
    verifier.verify.mockResolvedValue('user_1');
    users.resolveFromClerk.mockRejectedValue(new Error('clerk down'));
    await expect(resolver.resolveUserId('Bearer ok')).resolves.toBeUndefined();
  });

  it('returns the local user id only for an active user', async () => {
    verifier.verify.mockResolvedValue('user_1');
    users.resolveFromClerk.mockResolvedValue({ id: 'local-1', status: UserStatus.Active });
    await expect(resolver.resolveUserId('Bearer ok')).resolves.toBe('local-1');
    users.resolveFromClerk.mockResolvedValue({ id: 'local-1', status: UserStatus.Suspended });
    await expect(resolver.resolveUserId('Bearer ok')).resolves.toBeUndefined();
  });

  it('treats a deactivated (active: false) user as anonymous', async () => {
    verifier.verify.mockResolvedValue('user_1');
    users.resolveFromClerk.mockResolvedValue({
      id: 'local-1',
      status: UserStatus.Active,
      active: false,
    });
    await expect(resolver.resolveUserId('Bearer ok')).resolves.toBeUndefined();
    users.resolveFromClerk.mockResolvedValue({
      id: 'local-1',
      status: UserStatus.Active,
      active: true,
    });
    await expect(resolver.resolveUserId('Bearer ok')).resolves.toBe('local-1');
  });
});
