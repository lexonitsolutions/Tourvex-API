import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { appError } from '../app-error';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Base for every admin list query: `?q=&page=&limit=(default 20, max 100)&sort=field:asc|desc`.
 * Extend it with module-specific filters and pass `sort` through `parseSort` with a whitelist.
 */
export class PagingQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_SIZE, minimum: 1, maximum: MAX_PAGE_SIZE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ example: 'createdAt:desc', description: 'field:asc|desc' })
  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9_.]{0,39}:(asc|desc)$/, {
    message: 'sort must look like field:asc or field:desc',
  })
  sort?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export function buildPagination(page: number, limit: number, total: number): Pagination {
  return { page, limit, total, pages: Math.ceil(total / limit) };
}

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Turns `field:dir` into a Mongo sort. Fields outside the whitelist are a 400 (never passed to the
 * database); `_id` is appended as a stable tie-breaker.
 */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: { field: string; dir: 1 | -1 },
): Record<string, 1 | -1> {
  let field = fallback.field;
  let dir = fallback.dir;
  if (sort) {
    const [requested, direction] = sort.split(':');
    if (!allowed.includes(requested)) {
      throw appError(400, 'INVALID_SORT', `sort field must be one of: ${allowed.join(', ')}`);
    }
    field = requested;
    dir = direction === 'asc' ? 1 : -1;
  }
  return field === '_id' ? { _id: dir } : { [field]: dir, _id: dir };
}

/** Escapes user text for use inside a RegExp (case-insensitive search filters). */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
