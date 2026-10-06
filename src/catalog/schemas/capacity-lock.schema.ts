import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * One row per activity option and service day. Order creation increments the row inside its transaction, so two
 * checkouts competing for the same day conflict, the loser re-reads the fresh capacity and fails cleanly instead of
 * overselling. Rows carry no data; old days age out through the TTL index.
 */
@Schema({ collection: 'capacity_locks' })
export class CapacityLock {
  @Prop({ type: String, required: true, unique: true })
  key: string;

  @Prop({ type: Number, default: 0 })
  version: number;

  @Prop({ type: Date, default: Date.now, expires: 60 * 60 * 24 * 120 })
  touchedAt: Date;
}

export const CapacityLockSchema = SchemaFactory.createForClass(CapacityLock);
