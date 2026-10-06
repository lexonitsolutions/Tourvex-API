import { randomBytes } from 'node:crypto';

/**
 * Upload inspection: the file type is decided from the magic bytes, never from the file name or the
 * declared content type. SVG (and anything XML/HTML-like) is refused outright.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DIMENSION = 8000;

export type ImageType = 'png' | 'jpeg' | 'webp' | 'avif';

export const IMAGE_MIME: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};
export const IMAGE_EXT: Record<ImageType, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };

export type ImageProbe =
  | { ok: true; type: ImageType; width: number; height: number }
  | { ok: false; code: 'SVG_NOT_ALLOWED' | 'UNSUPPORTED_TYPE' | 'INVALID_IMAGE' | 'IMAGE_TOO_LARGE'; message: string };

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte);

function looksLikeMarkup(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString('utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '').trimStart().toLowerCase();
  return head.startsWith('<') || head.includes('<svg') || head.includes('<!doctype');
}

export function sniffImageType(buffer: Buffer): ImageType | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brands = [buffer.toString('ascii', 8, 12)];
    const boxSize = buffer.readUInt32BE(0);
    for (let offset = 16; offset + 4 <= Math.min(boxSize, buffer.length, 64); offset += 4) {
      brands.push(buffer.toString('ascii', offset, offset + 4));
    }
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
  }
  return null;
}

function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function avifSize(buffer: Buffer): { width: number; height: number } | null {
  // The image spatial extents property box ('ispe') holds the size: version/flags(4) width(4) height(4).
  const index = buffer.indexOf('ispe', 0, 'ascii');
  if (index < 4 || index + 16 > buffer.length) return null;
  return { width: buffer.readUInt32BE(index + 8), height: buffer.readUInt32BE(index + 12) };
}

/** Inspects an uploaded file. Pure: no I/O. */
export function probeImage(buffer: Buffer): ImageProbe {
  if (buffer.length === 0) return { ok: false, code: 'INVALID_IMAGE', message: 'The file is empty' };
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'IMAGE_TOO_LARGE', message: 'Images can be at most 5 MB' };
  }
  const type = sniffImageType(buffer);
  if (!type) {
    if (looksLikeMarkup(buffer)) {
      return { ok: false, code: 'SVG_NOT_ALLOWED', message: 'SVG and markup files are not allowed; upload PNG, JPEG, WebP or AVIF' };
    }
    return { ok: false, code: 'UNSUPPORTED_TYPE', message: 'Only PNG, JPEG, WebP and AVIF images are accepted' };
  }
  const size = { png: pngSize, jpeg: jpegSize, webp: webpSize, avif: avifSize }[type](buffer);
  if (!size || size.width < 1 || size.height < 1) {
    return { ok: false, code: 'INVALID_IMAGE', message: 'The image is corrupt or its size cannot be read' };
  }
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    return {
      ok: false,
      code: 'IMAGE_TOO_LARGE',
      message: `Images can be at most ${MAX_DIMENSION} x ${MAX_DIMENSION} pixels (this one is ${size.width} x ${size.height})`,
    };
  }
  return { ok: true, type, width: size.width, height: size.height };
}

/** `cms-<64 random bits>.<ext>`: never derived from the uploaded name. */
export function randomMediaFilename(type: ImageType): string {
  return `cms-${randomBytes(8).toString('hex')}.${IMAGE_EXT[type]}`;
}

/** Keeps a human-friendly original name for the library (display only, never used as a path). */
export function cleanOriginalName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001F\u007F<>"]/g, '').slice(0, 120);
}
