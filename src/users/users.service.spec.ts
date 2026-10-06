import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ClerkService } from '../clerk/clerk.service';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from './schemas/user.schema';
import { UserIdentityCache } from './user-identity.cache';
import { UsersService } from './users.service';

type Doc = Record<string, any>;

/** Minimal stand-in for a Mongoose query: supports .lean().exec(), .select() and .exec(). */
function query<T>(value: T) {
  const q = {
    lean: () => q,
    select: () => q,
    exec: () => Promise.resolve(value),
  };
  return q;
}

function clerkUser(email: string, verification: 'verified' | 'unverified', names = {}) {
  return {
    id: 'user_clerk_1',
    firstName: 'Amira',
    lastName: 'Haddad',
    primaryEmailAddressId: 'idn_primary',
    emailAddresses: [
      { id: 'idn_other', emailAddress: 'other@example.com', verification: { status: 'verified' } },
      { id: 'idn_primary', emailAddress: email, verification: { status: verification } },
    ],
    ...names,
  };
}

describe('UsersService.resolveFromClerk (just-in-time provisioning)', () => {
  const clerkUserId = 'user_clerk_1';
  let byClerkId: Doc | null;
  let byEmail: Doc | null;
  let model: Record<string, jest.Mock>;
  let getUser: jest.Mock;
  let cache: UserIdentityCache;
  let service: UsersService;

  beforeEach(() => {
    byClerkId = null;
    byEmail = null;
    model = {
      findOne: jest.fn((filter: Doc) =>
        query('clerkUserId' in filter ? byClerkId : 'email' in filter ? byEmail : null),
      ),
      findByIdAndUpdate: jest.fn((id: Types.ObjectId, update: Doc) =>
        query({ ...byEmail, _id: id, ...update.$set }),
      ),
      create: jest.fn((doc: Doc) =>
        Promise.resolve({ toObject: () => ({ _id: new Types.ObjectId(), ...doc }) }),
      ),
    };
    getUser = jest.fn();
    const clerk = { client: { users: { getUser } } } as unknown as ClerkService;
    cache = new UserIdentityCache();
    service = new UsersService(model as any, clerk, cache);
  });

  it('returns an already linked user without calling Clerk, then serves it from cache', async () => {
    const id = new Types.ObjectId();
    byClerkId = {
      _id: id,
      clerkUserId,
      email: 'a@example.com',
      roles: [Role.Admin],
      status: UserStatus.Active,
    };

    const first = await service.resolveFromClerk(clerkUserId);
    const second = await service.resolveFromClerk(clerkUserId);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ id: id.toString(), roles: [Role.Admin], clerkUserId });
    expect(getUser).not.toHaveBeenCalled();
    expect(model.findOne).toHaveBeenCalledTimes(1);
  });

  it('links a VERIFIED primary email to the existing local user and keeps its roles', async () => {
    const adminId = new Types.ObjectId();
    byEmail = {
      _id: adminId,
      email: 'owner@example.com',
      roles: [Role.SuperAdmin],
      status: UserStatus.Active,
    };
    getUser.mockResolvedValue(clerkUser('Owner@Example.com', 'verified'));

    const identity = await service.resolveFromClerk(clerkUserId);

    expect(model.findOne).toHaveBeenCalledWith({ email: 'owner@example.com' });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      adminId,
      { $set: { clerkUserId } },
      { returnDocument: 'after' },
    );
    expect(model.create).not.toHaveBeenCalled();
    expect(identity).toMatchObject({
      id: adminId.toString(),
      roles: [Role.SuperAdmin],
      clerkUserId,
    });
  });

  it('never links an UNVERIFIED email to an existing local user (403)', async () => {
    byEmail = {
      _id: new Types.ObjectId(),
      email: 'owner@example.com',
      roles: [Role.SuperAdmin],
      status: UserStatus.Active,
    };
    getUser.mockResolvedValue(clerkUser('owner@example.com', 'unverified'));

    await expect(service.resolveFromClerk(clerkUserId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it.each(['verified', 'unverified'] as const)(
    'creates a new active customer when no local user owns the %s email',
    async (verification) => {
      getUser.mockResolvedValue(clerkUser('new@example.com', verification));

      const identity = await service.resolveFromClerk(clerkUserId);

      expect(model.create).toHaveBeenCalledWith({
        firstName: 'Amira',
        lastName: 'Haddad',
        email: 'new@example.com',
        clerkUserId,
        roles: [Role.Customer],
        status: UserStatus.Active,
      });
      expect(identity).toMatchObject({
        email: 'new@example.com',
        roles: [Role.Customer],
        status: UserStatus.Active,
      });
    },
  );

  it('falls back to the email local part when Clerk has no names', async () => {
    getUser.mockResolvedValue(
      clerkUser('traveller@example.com', 'verified', { firstName: null, lastName: null }),
    );
    await service.resolveFromClerk(clerkUserId);
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'traveller', lastName: '' }),
    );
  });

  it('resolves the concurrent first-request race via the unique index', async () => {
    const racedId = new Types.ObjectId();
    getUser.mockResolvedValue(clerkUser('race@example.com', 'verified'));
    model.create.mockImplementationOnce(() => {
      // The parallel request inserted the same Clerk user first.
      byClerkId = {
        _id: racedId,
        clerkUserId,
        email: 'race@example.com',
        roles: [Role.Customer],
        status: UserStatus.Active,
      };
      return Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    });

    const identity = await service.resolveFromClerk(clerkUserId);

    expect(identity.id).toBe(racedId.toString());
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('retries as a link when a parallel request created the same email for another path', async () => {
    getUser.mockResolvedValue(clerkUser('race@example.com', 'verified'));
    const otherId = new Types.ObjectId();
    model.create.mockImplementationOnce(() => {
      byEmail = {
        _id: otherId,
        email: 'race@example.com',
        roles: [Role.Customer],
        status: UserStatus.Active,
      };
      return Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    });

    const identity = await service.resolveFromClerk(clerkUserId);

    expect(identity.id).toBe(otherId.toString());
    expect(model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects a token for a Clerk user that no longer exists with 401', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    await expect(service.resolveFromClerk(clerkUserId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('invalidates the cached identity when roles change', async () => {
    const id = new Types.ObjectId();
    byClerkId = {
      _id: id,
      clerkUserId,
      email: 'a@example.com',
      roles: [Role.Customer],
      status: UserStatus.Active,
    };
    await service.resolveFromClerk(clerkUserId);
    expect(cache.get(clerkUserId)).toBeDefined();

    model.findByIdAndUpdate.mockReturnValueOnce(query({ ...byClerkId, roles: [Role.Admin] }));
    await service.updateRoles(id.toString(), [Role.Admin]);

    expect(cache.get(clerkUserId)).toBeUndefined();
  });
});
