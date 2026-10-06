import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { Role } from '../src/common/enums/role.enum';
import { User, UserSchema, UserStatus } from '../src/users/schemas/user.schema';

/**
 * Upserts the first super-administrator as a LOCAL user (no password: sign-in is handled by Clerk).
 * When this person signs up / signs in with Clerk using the same, verified email address, the API
 * links the Clerk account to this record on the first request and the super_admin role applies.
 */
async function run() {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set SEED_ADMIN_EMAIL to a valid email address before running seed:admin.');
  }

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const users = mongoose.model<User>(User.name, UserSchema);
  const user = await users.findOneAndUpdate(
    { email },
    {
      $set: { status: UserStatus.Active },
      $addToSet: { roles: Role.SuperAdmin },
      $setOnInsert: {
        firstName: 'Tourvex',
        lastName: 'Administrator',
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
        id: user._id.toString(),
        email,
        roles: user.roles,
        linkedToClerk: Boolean(user.clerkUserId),
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
