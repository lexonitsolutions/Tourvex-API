import { Injectable } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Module } from '@nestjs/common';
import { Model } from 'mongoose';

/** `formatSequence('TKT', 42)` -> `TKT-000042`. Numbers past the width simply grow. */
export function formatSequence(prefix: string, value: number, width = 6): string {
  return `${prefix}-${String(value).padStart(width, '0')}`;
}

/** Named monotonically increasing counters (ticket and lead numbers). One document per name. */
@Schema({ collection: 'crm_counters', versionKey: false })
export class CrmCounter {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}
export const CounterSchema = SchemaFactory.createForClass(CrmCounter);

@Injectable()
export class CounterService {
  constructor(@InjectModel(CrmCounter.name) private readonly counters: Model<CrmCounter>) {}

  /** Atomic `$inc` upsert: two concurrent callers never receive the same number. */
  async next(name: string): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .lean<CrmCounter>()
      .exec();
    return doc.seq;
  }

  /** Makes sure the counter is at least `value` (used after a backfill). */
  async ensureAtLeast(name: string, value: number): Promise<void> {
    await this.counters
      .updateOne({ _id: name }, { $max: { seq: value } }, { upsert: true })
      .exec();
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: CrmCounter.name, schema: CounterSchema }])],
  providers: [CounterService],
  exports: [CounterService],
})
export class CountersModule {}
