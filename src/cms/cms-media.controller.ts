import { Controller, Delete, Get, HttpException, Param, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import multer from 'multer';
import { mongo } from 'mongoose';
import { RequirePermission } from '../admin/require-permission.decorator';
import { Audited, AuditInterceptor, setAuditContext } from '../audit/audited';
import { appError } from '../common/app-error';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { buildPagination, PagingQueryDto, skipFor } from '../common/query/paging-query.dto';
import { ParseObjectIdPipe } from '../holidays/parse-object-id.pipe';
import { MediaService } from '../media/media.service';
import { cleanOriginalName, IMAGE_MIME, MAX_UPLOAD_BYTES, probeImage, randomMediaFilename } from './cms.image';

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 8 },
}).single('file');

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const videoUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 5, parts: 8 },
}).single('file');

function readUpload(request: Request, response: Response): Promise<Express.Multer.File | undefined> {
  return new Promise((resolve, reject) => {
    uploader(request, response, (error: unknown) => {
      if (!error) return resolve(request.file);
      const code = (error as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') {
        return reject(appError(413, 'IMAGE_TOO_LARGE', 'Images can be at most 5 MB'));
      }
      reject(appError(400, 'INVALID_UPLOAD', 'Send one image in the multipart field "file"'));
    });
  });
}

function readVideoUpload(request: Request, response: Response): Promise<Express.Multer.File | undefined> {
  return new Promise((resolve, reject) => {
    videoUploader(request, response, (error: unknown) => {
      if (!error) return resolve(request.file);
      const code = (error as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') {
        return reject(appError(413, 'VIDEO_TOO_LARGE', 'Videos can be at most 50 MB'));
      }
      reject(appError(400, 'INVALID_UPLOAD', 'Send one video in the multipart field "file"'));
    });
  });
}

const VIDEO_EXT_MAP: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogg',
};

function detectVideoExtension(buffer: Buffer, originalName?: string, declaredMime?: string): string | null {
  if (buffer.length >= 8 && buffer.readUInt32BE(4) === 0x66747970) return 'mp4';
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm';
  if (buffer.length >= 4 && buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'ogg';
  if (declaredMime && VIDEO_EXT_MAP[declaredMime]) return VIDEO_EXT_MAP[declaredMime];
  const match = /\.(mp4|webm|mov|ogg)$/i.exec(originalName || '');
  return match ? match[1].toLowerCase() : null;
}

const view = (file: mongo.GridFSFile) => {
  const meta = (file.metadata ?? {}) as Record<string, unknown>;
  const isVideo =
    (typeof meta.contentType === 'string' && meta.contentType.startsWith('video/')) ||
    /\.(mp4|webm|mov|ogg)$/i.test(file.filename);
  return {
    id: file._id.toHexString(),
    url: isVideo ? `/videos/${file.filename}` : `/images/${file.filename}`,
    filename: file.filename,
    width: typeof meta.width === 'number' ? meta.width : null,
    height: typeof meta.height === 'number' ? meta.height : null,
    size: file.length,
    contentType: typeof meta.contentType === 'string' ? meta.contentType : 'application/octet-stream',
    uploadedAt: file.uploadDate,
    source: meta.source === 'cms' ? 'upload' : 'site',
    originalName: typeof meta.originalName === 'string' ? meta.originalName : null,
  };
};

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/media')
@UseInterceptors(AuditInterceptor)
export class CmsMediaController {
  constructor(
    private readonly media: MediaService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('cms.write')
  @Audited('content_media', 'media.upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one image (png/jpeg/webp/avif, max 5 MB, max 8000 px, no SVG)' })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set('Cache-Control', 'no-store');
    const file = await readUpload(request, response);
    if (!file) throw appError(400, 'FILE_REQUIRED', 'Send one image in the multipart field "file"');

    const probe = probeImage(file.buffer);
    if (!probe.ok) {
      const status = probe.code === 'IMAGE_TOO_LARGE' ? 413 : probe.code === 'INVALID_IMAGE' ? 400 : 415;
      throw appError(status, probe.code, probe.message);
    }
    if (file.mimetype && file.mimetype !== 'application/octet-stream' && file.mimetype !== IMAGE_MIME[probe.type]) {
      throw appError(415, 'MIME_MISMATCH', 'The file content does not match its declared type');
    }

    const filename = randomMediaFilename(probe.type);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const id = await this.media.uploadBuffer(filename, file.buffer, {
      source: 'cms',
      contentType: IMAGE_MIME[probe.type],
      checksum,
      width: probe.width,
      height: probe.height,
      originalName: cleanOriginalName(file.originalname),
      uploadedBy: user.email,
    });
    setAuditContext(request, {
      entityId: id.toHexString(),
      summary: `Uploaded image ${filename} (${probe.width}x${probe.height}, ${file.size} bytes)`,
      changes: [{ field: 'filename', from: null, to: filename }],
    });
    return {
      id: id.toHexString(),
      url: `/images/${filename}`,
      filename,
      width: probe.width,
      height: probe.height,
      size: file.size,
      contentType: IMAGE_MIME[probe.type],
    };
  }

  @Post('video')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('cms.write')
  @Audited('content_media', 'media.upload_video')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one video clip (mp4/webm/mov/ogg, max 50 MB)' })
  async uploadVideo(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set('Cache-Control', 'no-store');
    const file = await readVideoUpload(request, response);
    if (!file) throw appError(400, 'FILE_REQUIRED', 'Send one video in the multipart field "file"');

    const ext = detectVideoExtension(file.buffer, file.originalname, file.mimetype);
    if (!ext) {
      throw appError(415, 'UNSUPPORTED_TYPE', 'Only MP4, WebM, MOV and OGG video clips are supported');
    }

    const mime =
      file.mimetype && file.mimetype.startsWith('video/')
        ? file.mimetype
        : ext === 'webm'
        ? 'video/webm'
        : ext === 'mov'
        ? 'video/quicktime'
        : ext === 'ogg'
        ? 'video/ogg'
        : 'video/mp4';

    const filename = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const id = await this.media.uploadBuffer(filename, file.buffer, {
      source: 'cms',
      contentType: mime,
      checksum,
      originalName: cleanOriginalName(file.originalname),
      uploadedBy: user.email,
    });

    setAuditContext(request, {
      entityId: id.toHexString(),
      summary: `Uploaded video ${filename} (${file.size} bytes)`,
      changes: [{ field: 'filename', from: null, to: filename }],
    });

    return {
      id: id.toHexString(),
      url: `/videos/${filename}`,
      filename,
      size: file.size,
      contentType: mime,
    };
  }

  @Get()
  @RequirePermission('cms.write')
  @ApiOperation({ summary: 'Media library (CMS uploads and the site images), newest first' })
  async list(@Query() query: PagingQueryDto, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const { files, total } = await this.media.listFiles({
      filenameContains: query.q?.trim() || undefined,
      skip: skipFor(query.page, query.limit),
      limit: query.limit,
    });
    return { items: files.map(view), pagination: buildPagination(query.page, query.limit, total) };
  }

  @Get('videos')
  @RequirePermission('cms.write')
  @ApiOperation({ summary: 'Video media library, including legacy video uploads, newest first' })
  async listVideos(@Query() query: PagingQueryDto, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const { files, total } = await this.media.listFiles({
      filenameContains: query.q?.trim() || undefined,
      skip: skipFor(query.page, query.limit),
      limit: query.limit,
      kind: 'video',
    });
    return { items: files.map(view), pagination: buildPagination(query.page, query.limit, total) };
  }

  @Get('all')
  @RequirePermission('cms.write')
  @ApiOperation({ summary: 'All uploaded media, newest first' })
  async listAll(@Query() query: PagingQueryDto, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const { files, total } = await this.media.listFiles({ filenameContains: query.q?.trim() || undefined, skip: skipFor(query.page, query.limit), limit: query.limit, kind: 'all' });
    return { items: files.map(view), pagination: buildPagination(query.page, query.limit, total) };
  }

  @Get(':id/references')
  @RequirePermission('cms.write')
  @ApiOperation({ summary: 'Show where a media item is used' })
  async references(@Param('id', ParseObjectIdPipe) id: string, @Res({ passthrough: true }) response: Response) {
    response.set('Cache-Control', 'no-store');
    const file = await this.media.findFileById(id);
    if (!file) throw appError(404, 'MEDIA_NOT_FOUND', 'Media not found');
    const activeVersion = await this.media.isActiveFilenameVersion(file);
    return { item: view(file), activeVersion, references: activeVersion ? await this.media.findApplicationReferences(file.filename) : [] };
  }

  @Delete(':id')
  @RequirePermission('cms.write')
  @Audited('content_media', 'media.delete')
  @ApiOperation({ summary: 'Delete an uploaded image (409 when a document still uses it)' })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set('Cache-Control', 'no-store');
    const file = await this.media.findFileById(id);
    if (!file) throw appError(404, 'MEDIA_NOT_FOUND', 'Image not found');
    if ((file.metadata)?.source !== 'cms') {
      throw appError(403, 'MEDIA_PROTECTED', 'Only images uploaded through the CMS can be deleted');
    }
    const activeVersion = await this.media.isActiveFilenameVersion(file);
    const references = activeVersion ? await this.media.findApplicationReferences(file.filename) : [];
    if (references.length) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'MEDIA_IN_USE',
          message: 'This image is still used by content and cannot be deleted',
          references,
        },
        409,
      );
    }
    await this.media.deleteFile(file._id);
    setAuditContext(request, {
      entityId: id,
      summary: `Deleted image ${file.filename}`,
      changes: [{ field: 'filename', from: file.filename, to: null }],
    });
    return { id, deleted: true };
  }
}
