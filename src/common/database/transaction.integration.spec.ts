import mongoose, { Schema } from 'mongoose';
import { TransactionService } from './transaction.service';

/**
 * Runs against a real MongoDB replica set (the same one the API uses), in a throw-away database. Skipped when no
 * replica set is reachable, so `npm test` still passes on a machine without Docker.
 */
const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex?replicaSet=rs0';
const dbName = `tourvex_tx_test_${Date.now()}`;

let connection: mongoose.Connection | undefined;
let available = false;

beforeAll(async () => {
  try {
    const candidate = mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 2_000 });
    await candidate.asPromise();
    const hello = await candidate.db!.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error('not a replica set');
    connection = candidate;
    available = true;
  } catch {
    available = false;
  }
}, 15_000);

afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!available) return console.warn(`SKIPPED (no MongoDB replica set): ${name}`);
    await fn();
  }, 30_000);

describe('TransactionService against MongoDB', () => {
  const makeModels = () => {
    const Booking = connection!.model('Booking', new Schema({ ref: String, qty: Number }, { collection: 'tx_bookings' }));
    const Lock = connection!.model('Lock', new Schema({ key: { type: String, unique: true }, version: Number }, { collection: 'tx_locks' }));
    return { Booking, Lock };
  };

  maybe('commits every write together', async () => {
    const { Booking } = makeModels();
    await Booking.createCollection();
    const service = new TransactionService(connection!);
    await service.run(async (session) => {
      await Booking.create([{ ref: 'a', qty: 1 }], { session });
      await Booking.create([{ ref: 'b', qty: 1 }], { session });
    });
    expect(await Booking.countDocuments({ ref: { $in: ['a', 'b'] } })).toBe(2);
  });

  maybe('rolls back every write when the work fails half-way', async () => {
    const { Booking } = makeModels();
    await Booking.createCollection();
    const service = new TransactionService(connection!);
    await expect(
      service.run(async (session) => {
        await Booking.create([{ ref: 'half-1', qty: 1 }], { session });
        await Booking.create([{ ref: 'half-2', qty: 1 }], { session });
        throw new Error('crash before the order is complete');
      }),
    ).rejects.toThrow('crash before');
    expect(await Booking.countDocuments({ ref: { $in: ['half-1', 'half-2'] } })).toBe(0);
  });

  /**
   * The checkout oversell guard: every checkout takes the capacity lock, re-counts what is booked, and books only if
   * a place is left. With 5 buyers racing for 2 places exactly 2 may succeed.
   */
  maybe('never oversells when many checkouts race for the last places (capacity lock)', async () => {
    const { Booking, Lock } = makeModels();
    await Booking.createCollection();
    await Lock.createCollection();
    await Lock.syncIndexes();
    await Lock.updateOne({ key: 'safari|opt|2030-01-01' }, { $setOnInsert: { version: 0 } }, { upsert: true });
    const service = new TransactionService(connection!);
    const CAPACITY = 2;

    const buy = (buyer: string) =>
      service
        .run(async (session) => {
          await Lock.updateOne({ key: 'safari|opt|2030-01-01' }, { $inc: { version: 1 } }, { session });
          const [row] = await Booking.aggregate([{ $match: { ref: /^race-/ } }, { $group: { _id: null, qty: { $sum: '$qty' } } }]).session(session);
          if ((row?.qty ?? 0) + 1 > CAPACITY) throw new Error('DATE_UNAVAILABLE');
          await Booking.create([{ ref: `race-${buyer}`, qty: 1 }], { session });
          return 'booked';
        })
        .catch((error: Error) => error.message);

    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(buy));
    expect(results.filter((r) => r === 'booked')).toHaveLength(CAPACITY);
    expect(results.filter((r) => r === 'DATE_UNAVAILABLE')).toHaveLength(5 - CAPACITY);
    expect(await Booking.countDocuments({ ref: /^race-/ })).toBe(CAPACITY);
  });
});
