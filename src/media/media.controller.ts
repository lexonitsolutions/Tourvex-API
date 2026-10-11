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

  @Public()
  @Get('videos/:filename')
  @ApiOperation({ summary: 'Stream a website video stored in MongoDB GridFS with HTTP Range support' })
  @ApiOkResponse({ description: 'The video stream with partial content support' })
  @ApiNotFoundResponse({ description: 'The video is not present in the media database' })
  async getVideo(
    @Param('filename') filename: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const media = await this.media.findMedia(filename);
    const total = media.file.length;
    const contentType = media.contentType || 'video/mp4';

    response.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Type': contentType,
      'Last-Modified': media.file.uploadDate.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'X-Tourvex-Media-Source': 'mongodb-gridfs',
    });

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

      if (isNaN(start) || isNaN(end) || start >= total || end >= total || start > end) {
        response.status(416).set('Content-Range', `bytes */${total}`).end();
        return;
      }

      const chunksize = end - start + 1;
      response.status(206);
      response.set({
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(chunksize),
      });

      const stream = this.media.openDownloadStream(media.file._id, { start, end: end + 1 });
      stream.pipe(response);
      return;
    }

    response.status(200);
    response.set('Content-Length', String(total));
    const stream = this.media.openDownloadStream(media.file._id);
    stream.pipe(response);
  }
}
