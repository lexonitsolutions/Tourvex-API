import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

/**
 * Runs a unit of work as one MongoDB multi-document transaction (needs a replica set, which every
 * environment already uses). Everything done with the `session` is committed together or not at all.
 *
 * Mongoose re-runs `work` when MongoDB reports a transient error (a write conflict with a concurrent
 * transaction, a failover), so `work` must only touch the database through `session`, never send an
 * e-mail or call a payment provider, and must re-read anything it decides on (it does so on each attempt).
 */
@Injectable()
export class TransactionService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.connection.transaction(work, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: 10_000,
    });
  }
}
