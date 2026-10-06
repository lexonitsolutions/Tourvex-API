import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { Role } from '../src/common/enums/role.enum';
import { User, UserSchema, UserStatus } from '../src/users/schemas/user.schema';

/**
 * Bootstraps (or repairs) the first admin: creates or updates ONE local user as an active
 * super_admin, identified by email. Idempotent and safe to repeat; it never creates duplicates
 * (email is a unique index and the write is a single upsert), never sets a password and makes no
 * Clerk call. The person signs in with Clerk using the same verified email and the API links the
 * account on the first request (the same provisioning customers use).
 *
 *   npm run seed:staff -- --email owner@example.com [--name "Owner Name"]
 */
async function run() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  });
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: npm run seed:staff -- --email <valid email> [--name "Full Name"]');
  }
  const [firstName, ...rest] = (values.name?.trim() || email.split('@')[0]).split(/\s+/);

  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  try {
    const users = mongoose.model<User>(User.name, UserSchema);
    const before = await users.findOne({ email }).select('_id').lean().exec();
    const user = await users.findOneAndUpdate(
      { email },
      {
        $set: { status: UserStatus.Active, active: true },
        $addToSet: { roles: { $each: [Role.Customer, Role.SuperAdmin] } },
        $setOnInsert: {
          firstName,
          lastName: rest.join(' '),
          email,
          preferredLocale: 'en',
          preferredCurrency: 'AED',
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    console.log(
      JSON.stringify(
        {
          result: before ? 'updated' : 'created',
          id: user._id.toString(),
          email,
          roles: user.roles,
          linkedToClerk: Boolean(user.clerkUserId),
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
