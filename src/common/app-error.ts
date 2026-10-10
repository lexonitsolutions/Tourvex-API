import { HttpException } from '@nestjs/common';

/** Error with a stable machine-readable `code` next to the human message (400/404/409 ...). */
export function appError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

/** Like `appError`, plus extra machine-readable fields in the body (e.g. the offending `date` or the `available` units). */
export function appErrorWith(status: number, code: string, message: string, extra: Record<string, unknown>): HttpException {
  return new HttpException({ statusCode: status, code, message, ...extra }, status);
}
