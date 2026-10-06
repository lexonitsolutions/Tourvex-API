import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';

export const NOTE_MAX_LENGTH = 2000;

/**
 * Internal notes / timeline entry, embedded as `notes: Note[]` in bookings, enquiries, tickets and
 * customers: `@Prop({ type: [NoteSchema], default: [] }) notes: Note[]`. Append-only by convention.
 */
@Schema({ _id: false })
export class Note {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: Date, required: true })
  at: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  authorName: string;

  @Prop({ type: String, required: true, trim: true, maxlength: NOTE_MAX_LENGTH })
  text: string;
}

export const NoteSchema = SchemaFactory.createForClass(Note);

/** Body of `POST /admin/<module>/:id/notes`. */
export class AddNoteDto {
  @ApiProperty({ maxLength: NOTE_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_MAX_LENGTH)
  text: string;
}

export function buildNote(
  author: { id: string; name: string },
  text: string,
  now = new Date(),
): Note {
  return {
    id: randomUUID(),
    at: now,
    authorId: new Types.ObjectId(author.id),
    authorName: author.name,
    text: text.trim().slice(0, NOTE_MAX_LENGTH),
  };
}

/** Mongo update that appends a note; spread into `findOneAndUpdate(filter, appendNote(note))`. */
export function appendNote(note: Note) {
  return { $push: { notes: note } };
}
