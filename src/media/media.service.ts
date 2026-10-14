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
    kind?: 'image' | 'video' | 'all';
  }): Promise<{ files: mongo.GridFSFile[]; total: number }> {
    const videoRules = [
      { 'metadata.contentType': { $regex: '^video/' } },
      { filename: { $regex: '\\.(mp4|webm|mov|ogg)$', $options: 'i' } },
    ];
    const filter: Record<string, unknown> = options.kind === 'all' ? {} : options.kind === 'video'
      ? {
          $or: videoRules,
        }
      : { $nor: videoRules };
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

  /** Complete GridFS inventory counts used by the media-library tabs. */
  async mediaCounts(filenameContains?: string): Promise<{ all: number; images: number; videos: number }> {
    const [all, images, videos] = await Promise.all([
      this.listFiles({ filenameContains, skip: 0, limit: 1, kind: 'all' }),
      this.listFiles({ filenameContains, skip: 0, limit: 1, kind: 'image' }),
      this.listFiles({ filenameContains, skip: 0, limit: 1, kind: 'video' }),
    ]);
    return { all: all.total, images: images.total, videos: videos.total };
  }

  /** Finds stored content/catalog values that reference a media filename. Read-only and bounded per collection. */
  async findApplicationReferences(filename: string): Promise<Array<{ collection: string; id: string; title: string; path: string; href?: string; publicHref?: string }>> {
    if (!this.connection.db) throw new ServiceUnavailableException('Media database is unavailable');
    const collections = await this.connection.db.listCollections({}, { nameOnly: true }).toArray();
    const excluded = /^(media\.|audit_logs$|capacity_locks$|counters$|crm_counters$|fx_rates$|stock_alert_states$)/i;
    const hits: Array<{ collection: string; id: string; title: string; path: string; href?: string; publicHref?: string }> = [];
    const walk = (value: unknown, path: string, add: (path: string) => void) => {
      if (typeof value === 'string') {
        if (value === filename || value.endsWith(`/${filename}`)) add(path);
        return;
      }
      if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`, add));
      if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([key, item]) => walk(item, path ? `${path}.${key}` : key, add));
    };
    for (const { name } of collections.filter((item) => !excluded.test(item.name))) {
      const docs = await this.connection.db.collection(name).find({}).limit(5000).toArray();
      for (const doc of docs) {
        walk(doc, '', (path) => {
          const key = String(doc.key || doc.slug || doc._id);
          const title = String(doc.title || doc.name || doc.label || doc.key || key);
          const type = name.toLowerCase();
          const href = type === 'cms_documents' ? `/admin/content/${encodeURIComponent(String(doc.key || ''))}`
            : type === 'activities' ? `/admin/catalog/activities/${doc._id}`
            : type === 'holidays' ? `/admin/catalog/holidays/${doc._id}`
            : type === 'cruises' ? `/admin/catalog/cruises/${doc._id}`
            : type === 'events' ? `/admin/catalog/events/${doc._id}`
            : type === 'visas' ? `/admin/catalog/visas/${doc._id}` : undefined;
          const slug = typeof doc.slug === 'string' ? encodeURIComponent(doc.slug) : '';
          const publicHref = type === 'cms_documents' && doc.key === 'page.activities' ? '/activities'
            : type === 'cms_documents' && doc.key === 'page.home' ? '/'
            : type === 'activities' && slug ? `/activities/${slug}`
            : type === 'holidays' && slug ? `/holidays/${slug}`
            : type === 'cruises' && slug ? `/cruises/${slug}`
            : type === 'events' && slug ? `/events/${slug}`
            : type === 'visas' && slug ? `/visas/${slug}` : undefined;
          hits.push({ collection: name, id: key, title, path, href, publicHref });
        });
      }
    }
    return hits;
  }

  async isActiveFilenameVersion(file: mongo.GridFSFile): Promise<boolean> {
    const newest = await this.bucket.find({ filename: file.filename }).sort({ uploadDate: -1 }).limit(1).next();
    return Boolean(newest && newest._id.equals(file._id));
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
