import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { BookingsService } from '../src/bookings/bookings.service';
import { Booking, BookingStatus } from '../src/bookings/schemas/booking.schema';

/**
 * Issues the voucher and the invoice for every confirmed booking that lacks them. Idempotent and
 * safe to repeat (both are unique per booking), so it can also run after a deploy.
 *
 *   npm run backfill:vouchers
 */
async function run() {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const bookings = app.get<Model<Booking>>(getModelToken(Booking.name));
    const service = app.get(BookingsService);
    let processed = 0;
    const cursor = bookings
      .find({ status: { $in: [BookingStatus.Confirmed, BookingStatus.CancellationRequested] }, confirmedAt: { $exists: true } })
      .cursor();
    for await (const booking of cursor) {
      await service.afterConfirmed(booking);
      processed++;
    }
    console.log(JSON.stringify({ result: 'ok', bookingsChecked: processed }));
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
