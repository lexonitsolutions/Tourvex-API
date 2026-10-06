import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import mongoose from 'mongoose';

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function upload(
  bucket: mongoose.mongo.GridFSBucket,
  filename: string,
  data: Buffer,
  contentType: string,
  checksum: string,
) {
  await new Promise<void>((resolveUpload, rejectUpload) => {
    const stream = bucket.openUploadStream(filename, {
      metadata: {
        checksum,
        contentType,
        publicPath: `/images/${filename}`,
        source: 'tourvex-nextjs-public-images',
      },
    });
    stream.on('error', rejectUpload);
    stream.on('finish', () => resolveUpload());
    stream.end(data);
  });
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const sourceDirectory = resolve(
    process.cwd(),
    process.env.MEDIA_SOURCE_DIR ?? '../Tourvex-NextJS/public/images',
  );
  const filenames = (await readdir(sourceDirectory))
    .filter((filename) => MIME_TYPES[extname(filename).toLowerCase()])
    .sort();

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  if (!mongoose.connection.db) throw new Error('MongoDB connection is unavailable');

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'media' });
  const files = mongoose.connection.db.collection('media.files');
  await files.createIndex({ filename: 1, uploadDate: -1 });

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const filename of filenames) {
    const data = await readFile(resolve(sourceDirectory, filename));
    const checksum = createHash('sha256').update(data).digest('hex');
    const existing = await bucket.find({ filename }).sort({ uploadDate: -1 }).toArray();
    const currentChecksum = existing[0]?.metadata?.checksum;

    if (currentChecksum === checksum) {
      unchanged += 1;
      continue;
    }

    await upload(bucket, filename, data, MIME_TYPES[extname(filename).toLowerCase()], checksum);
    for (const previous of existing) await bucket.delete(previous._id);
    if (existing.length) updated += 1;
    else created += 1;
  }

  console.log(
    JSON.stringify(
      { sourceDirectory, discovered: filenames.length, created, updated, unchanged },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

void run();
