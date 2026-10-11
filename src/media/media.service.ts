import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';

export interface StoredMedia {
  file: mongo.GridFSFile;
  contentType: string;
  checksum: string;
}

@Injectable()
export class MediaService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findImage(filename: string): Promise<StoredMedia> {
    return this.findMedia(filename);
  }

  async findMedia(filename: string): Promise<StoredMedia> {
    const safeFilename = this.normalizeFilename(filename);
    const file = await this.bucket
      .find({ filename: safeFilename })
      .sort({ uploadDate: -1 })
      .limit(1)
      .next();

    if (!file) throw new NotFoundException(`Media asset '${safeFilename}' was not found`);

    const metadata = file.metadata ?? {};
    return {
      file,
      contentType:
        typeof metadata.contentType === 'string'
          ? metadata.contentType
          : 'application/octet-stream',
      checksum: typeof metadata.checksum === 'string' ? metadata.checksum : file._id.toHexString(),
    };
  }

  openDownloadStream(id: mongo.BSON.ObjectId, options?: mongo.GridFSBucketReadStreamOptions) {
    return this.bucket.openDownloadStream(id, options);
  }

  /** Stores a buffer in the media bucket (used by the CMS media library). Resolves with the GridFS file id. */
  uploadBuffer(
    filename: string,
    data: Buffer,
    metadata: Record<string, unknown>,
  ): Promise<mongo.BSON.ObjectId> {
    return new Promise((resolve, reject) => {
      const stream = this.bucket.openUploadStream(filename, { metadata });
      stream.once('error', reject);
      stream.once('finish', () => resolve(stream.id));
      stream.end(data);
    });
  }

  /** Lists image files, newest first. `filenameContains` is matched literally (case-insensitive). */
  async listFiles(options: {
    filenameContains?: string;
    skip: number;
    limit: number;
  }): Promise<{ files: mongo.GridFSFile[]; total: number }> {
    const filter: Record<string, unknown> = { 'metadata.contentType': { $regex: '^image/' } };
    if (options.filenameContains) {
      filter.filename = {
        $regex: options.filenameContains.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    }
    if (!this.connection.db) throw new ServiceUnavailableException('Media database is unavailable');
    const collection = this.connection.db.collection<mongo.GridFSFile>('media.files');
    const [files, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ uploadDate: -1, _id: -1 })
        .skip(options.skip)
        .limit(options.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);
    return { files, total };
  }

  async findFileById(id: string): Promise<mongo.GridFSFile | null> {
    return this.bucket.find({ _id: new mongo.BSON.ObjectId(id) }).next();
  }

  async deleteFile(id: mongo.BSON.ObjectId): Promise<void> {
    await this.bucket.delete(id);
  }

  private normalizeFilename(filename: string) {
    const decoded = decodeURIComponent(filename).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(decoded) || decoded.includes('..')) {
      throw new BadRequestException('Invalid media filename');
    }
    return decoded;
  }

  private get bucket() {
    if (!this.connection.db) throw new ServiceUnavailableException('Media database is unavailable');
    return new mongo.GridFSBucket(this.connection.db, { bucketName: 'media' });
  }
}
