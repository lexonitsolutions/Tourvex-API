import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class LocaleQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}$/, { message: 'locale must be a language code like "en"' })
  locale?: string;

  /** Signed preview token (draft). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  preview?: string;
}

export class BatchQueryDto extends LocaleQueryDto {
  @IsString()
  @MaxLength(400)
  keys: string;
}

export class AdminLocaleQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}$/, { message: 'locale must be a language code like "en"' })
  locale?: string;
}

export class SaveDraftDto {
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  sections?: unknown;

  /** The published `version` the editor loaded; a different current version answers 409. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseVersion?: number;

  /** The `draftRevision` the editor loaded (0 when there was no draft); a mismatch answers 409. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  draftRevision?: number;
}

export class PublishDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  draftRevision?: number;
}
