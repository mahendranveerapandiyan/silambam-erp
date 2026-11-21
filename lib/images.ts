import 'server-only';
import sharp from 'sharp';

const MAX_UPLOAD = 25_000_000; // accept any phone photo; it is compressed below

async function read(f: FormDataEntryValue | null) {
  if (!f || typeof f === 'string' || f.size === 0) return null;
  if (f.size > MAX_UPLOAD) throw new Error('File is larger than 25 MB');
  if (!f.type.startsWith('image/')) throw new Error('Please choose an image file');
  return Buffer.from(await f.arrayBuffer());
}

/**
 * Person photos: whatever size is uploaded, store a JPEG of at most 480 px
 * on the longest side and about 100 KB (quality is reduced step by step).
 */
export async function photoToJpeg(f: FormDataEntryValue | null, maxBytes = 100_000) {
  const buf = await read(f);
  if (!buf) return null;
  let img;
  try {
    img = sharp(buf, { failOn: 'none' }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true });
  } catch {
    throw new Error('This image format is not supported – please use JPG or PNG');
  }
  let out: Buffer | null = null;
  for (const q of [82, 72, 62, 52, 42]) {
    try {
      out = await img.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer();
    } catch {
      throw new Error('This image could not be read – please use a JPG or PNG photo (HEIC is not supported).');
    }
    if (out.length <= maxBytes) break;
  }
  return { mime: 'image/jpeg', data: out! };
}

/** Logos and payment QR codes: keep them sharp (PNG), just limit the size. */
export async function imageToPng(f: FormDataEntryValue | null, maxSide = 800) {
  const buf = await read(f);
  if (!buf) return null;
  try {
    const data = await sharp(buf, { failOn: 'none' }).rotate().resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    return { mime: 'image/png', data };
  } catch {
    throw new Error('This image could not be read – please use a JPG or PNG file.');
  }
}
