import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { MediaService } from './media.service';

@ApiTags('media')
@SkipThrottle()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get('images/:filename')
  @ApiOperation({ summary: 'Stream a website image stored in MongoDB GridFS' })
  @ApiOkResponse({ description: 'The image binary with immutable cache metadata' })
  @ApiNotFoundResponse({ description: 'The image is not present in the media database' })
  async getImage(
    @Param('filename') filename: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const media = await this.media.findImage(filename);
    const etag = `"sha256-${media.checksum}"`;

    response.set({
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Length': String(media.file.length),
      'Content-Type': media.contentType,
      ETag: etag,
      'Last-Modified': media.file.uploadDate.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'X-Tourvex-Media-Source': 'mongodb-gridfs',
    });

    if (ifNoneMatch === etag) {
      response.status(304).end();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const stream = this.media.openDownloadStream(media.file._id);
      stream.on('error', reject);
      response.on('finish', resolve);
      response.on('close', resolve);
      stream.pipe(response);
    });
  }
}
