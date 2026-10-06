import { HttpException } from '@nestjs/common';

/** Error with a stable machine-readable `code` next to the human message (400/404/409 ...). */
export function appError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}
