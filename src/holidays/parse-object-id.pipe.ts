import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[a-f0-9]{24}$/i.test(value)) throw new BadRequestException('id must be a valid ObjectId');
    return value;
  }
}
