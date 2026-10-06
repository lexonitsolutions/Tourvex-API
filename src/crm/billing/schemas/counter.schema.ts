import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Atomic named counters (invoice and credit-note sequences per year). */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
