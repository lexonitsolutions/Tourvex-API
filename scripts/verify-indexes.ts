import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';

/**
 * Deployment check for the indexes that keep money and bookings consistent. Run it against the target database
 * (`npm run indexes:verify`) before or after a release: it exits non-zero when a required unique index is missing
 * and reports duplicate values that would stop MongoDB from building one (a unique index cannot be created over
 * data that already breaks the rule, so those rows must be fixed first).
 *
 * The API itself creates these indexes at start-up (Mongoose autoIndex); this script is the proof, not the creator.
 */

interface Expectation {
  collection: string;
  keys: Record<string, 1 | -1>;
  /** Why the rule exists. */
  purpose: string;
  /** A unique index can be partial; the filter field must then match. */
  partial?: boolean;
}

const REQUIRED: Expectation[] = [
  { collection: 'bookings', keys: { reference: 1 }, purpose: 'booking references are never reused' },
  { collection: 'bookings', keys: { orderReference: 1, cartItemId: 1 }, partial: true, purpose: 'one booking per order item (retries cannot double-book)' },
  { collection: 'orders', keys: { orderReference: 1 }, purpose: 'order references are never reused' },
  { collection: 'orders', keys: { cartId: 1 }, partial: true, purpose: 'one active order per cart' },
  { collection: 'checkout_carts', keys: { userId: 1 }, partial: true, purpose: 'one active cart per customer' },
  { collection: 'invoices', keys: { invoiceNumber: 1 }, purpose: 'invoice and credit-note numbers are never reused' },
  { collection: 'invoices', keys: { bookingId: 1, kind: 1 }, partial: true, purpose: 'one invoice per booking' },
  { collection: 'invoices', keys: { refundId: 1 }, partial: true, purpose: 'one credit note per refund' },
  { collection: 'vouchers', keys: { code: 1 }, purpose: 'voucher codes are unique' },
  { collection: 'vouchers', keys: { bookingId: 1 }, purpose: 'one voucher per booking' },
  { collection: 'refunds', keys: { idempotencyKey: 1 }, partial: true, purpose: 'a repeated refund request cannot refund twice' },
  { collection: 'promo_codes', keys: { code: 1 }, purpose: 'promo codes are unique' },
  { collection: 'users', keys: { email: 1 }, purpose: 'one account per e-mail address' },
  { collection: 'users', keys: { clerkUserId: 1 }, purpose: 'one account per Clerk user' },
  { collection: 'capacity_locks', keys: { key: 1 }, purpose: 'one capacity lock per stock item and day' },
  { collection: 'stock_policies', keys: { productType: 1, productRef: 1, variantId: 1 }, purpose: 'one stock policy per item' },
  { collection: 'stock_days', keys: { productType: 1, productRef: 1, variantId: 1, date: 1 }, purpose: 'one stock override per item and date' },
  { collection: 'stock_alert_states', keys: { productType: 1, productRef: 1, variantId: 1, date: 1, state: 1 }, purpose: 'a stock alert is sent once per item, date and state' },
  { collection: 'stock_movements', keys: { bookingReference: 1, type: 1 }, partial: true, purpose: 'the automatic ledger rows of a booking are written once' },
];

const sameKeys = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

async function duplicates(collection: string, keys: Record<string, 1 | -1>, partial: boolean) {
  const fields = Object.keys(keys);
  const exists = Object.fromEntries(fields.map((field) => [field, { $exists: true, $ne: null }]));
  const rows = await mongoose.connection
    .db!.collection(collection)
    .aggregate([
      { $match: partial ? exists : {} },
      { $group: { _id: Object.fromEntries(fields.map((field) => [field, `$${field}`])), count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 },
    ])
    .toArray();
  return rows;
}

async function run() {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const existing = new Set((await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name));

  let failures = 0;
  for (const rule of REQUIRED) {
    const label = `${rule.collection} ${JSON.stringify(rule.keys)}`;
    if (!existing.has(rule.collection)) {
      console.log(`SKIP  ${label}: collection does not exist yet (created on first write; the API builds the index then)`);
      continue;
    }
    const indexes = await mongoose.connection.db!.collection(rule.collection).indexes();
    const found = indexes.find((index) => index.unique && sameKeys(index.key, rule.keys));
    if (found) {
      console.log(`OK    ${label}: ${rule.purpose}`);
      continue;
    }
    failures += 1;
    console.error(`MISSING ${label}: ${rule.purpose}`);
    const dupes = await duplicates(rule.collection, rule.keys, Boolean(rule.partial));
    if (dupes.length) {
      console.error(`        duplicate values block the index; fix these first: ${JSON.stringify(dupes)}`);
    } else {
      console.error('        no duplicates found: start the API once (it builds indexes on boot) and run this again');
    }
  }
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} required unique index(es) missing` : '\nAll required unique indexes are in place');
  if (failures) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
