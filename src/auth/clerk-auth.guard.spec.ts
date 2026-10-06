import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyToken } from '@clerk/backend';
import { ClerkTokenVerifier } from '../clerk/clerk-token-verifier.service';
import { ClerkService } from '../clerk/clerk.service';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { ClerkAuthGuard } from './clerk-auth.guard';

jest.mock('@clerk/backend', () => ({ verifyToken: jest.fn() }));

const mockedVerifyToken = verifyToken as jest.MockedFunction<typeof verifyToken>;

function contextFor(request: Record<string, any>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ClerkAuthGuard', () => {
  const localId = '665f1c2b9a1e4b0012345678';
  let reflector: { getAllAndOverride: jest.Mock };
  let users: { resolveFromClerk: jest.Mock };
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    mockedVerifyToken.mockReset();
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    users = { resolveFromClerk: jest.fn() };
    const clerk = {
      isConfigured: true,
      secretKey: 'sk_test_unit',
      authorizedParties: ['http://localhost:3000'],
    } as unknown as ClerkService;
    guard = new ClerkAuthGuard(
      reflector as unknown as Reflector,
      new ClerkTokenVerifier(clerk),
      users as unknown as UsersService,
    );
  });

  it('lets @Public() routes through without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('rejects a request without a bearer token with 401', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired/invalid token with a generic 401 and does not resolve a user', async () => {
    // The public verifyToken throws a TokenVerificationError on failure.
    mockedVerifyToken.mockRejectedValue(
      Object.assign(new Error('JWT is expired. secret details'), { reason: 'token-expired' }),
    );
    const attempt = guard.canActivate(contextFor({ headers: { authorization: 'Bearer bad' } }));
    await expect(attempt).rejects.toThrow(UnauthorizedException);
    await expect(attempt).rejects.toThrow('Authentication required');
    expect(users.resolveFromClerk).not.toHaveBeenCalled();
  });

  it('maps any verification failure (e.g. JWKS fetch) to 401', async () => {
    mockedVerifyToken.mockRejectedValue(new Error('jwks fetch failed'));
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer bad' } })),
    ).rejects.toThrow('Authentication required');
  });

  it('rejects a verified payload without a subject with 401', async () => {
    mockedVerifyToken.mockResolvedValue({ sid: 'sess_1' } as any);
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer odd' } })),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.resolveFromClerk).not.toHaveBeenCalled();
  });

  it.each([UserStatus.Pending, UserStatus.Suspended])(
    'rejects a %s user with 403',
    async (status) => {
      mockedVerifyToken.mockResolvedValue({ sub: 'user_123', sid: 'sess_1' } as any);
      users.resolveFromClerk.mockResolvedValue({
        id: localId,
        clerkUserId: 'user_123',
        email: 'a@example.com',
        roles: ['customer'],
        status,
      });
      const attempt = guard.canActivate(contextFor({ headers: { authorization: 'Bearer ok' } }));
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toThrow('Account is not active');
    },
  );

  it('rejects a deactivated (active: false) staff user with 403, but legacy users without the flag pass', async () => {
    mockedVerifyToken.mockResolvedValue({ sub: 'user_123', sid: 'sess_1' } as any);
    const identity = {
      id: localId,
      clerkUserId: 'user_123',
      email: 'a@example.com',
      roles: ['support'],
      status: UserStatus.Active,
    };
    users.resolveFromClerk.mockResolvedValue({ ...identity, active: false });
    const attempt = guard.canActivate(contextFor({ headers: { authorization: 'Bearer ok' } }));
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow('Account is not active');

    users.resolveFromClerk.mockResolvedValue({ ...identity, active: true });
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer ok' } })),
    ).resolves.toBe(true);
    users.resolveFromClerk.mockResolvedValue(identity);
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer ok' } })),
    ).resolves.toBe(true);
  });

  it('sets request.user with the LOCAL user id on success', async () => {
    mockedVerifyToken.mockResolvedValue({ sub: 'user_123', sid: 'sess_1' } as any);
    users.resolveFromClerk.mockResolvedValue({
      id: localId,
      clerkUserId: 'user_123',
      email: 'a@example.com',
      roles: ['customer', 'b2b_owner'],
      status: UserStatus.Active,
      partnerId: 'partner-1',
    });
    const request: Record<string, any> = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(mockedVerifyToken).toHaveBeenCalledWith('good-token', {
      secretKey: 'sk_test_unit',
      authorizedParties: ['http://localhost:3000'],
    });
    expect(users.resolveFromClerk).toHaveBeenCalledWith('user_123');
    expect(request.user).toEqual({
      sub: localId,
      email: 'a@example.com',
      roles: ['customer', 'b2b_owner'],
      partnerId: 'partner-1',
      clerkUserId: 'user_123',
    });
  });
});
