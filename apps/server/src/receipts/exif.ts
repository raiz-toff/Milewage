// Receipt photos may carry the place they were taken (01 section 2, privacy). The server removes
// the GPS data of a JPEG, PNG or WebP photo before storing it (18 section 5.4): the GPS directory of
// its Exif block is emptied and its XMP (which can repeat the place) is dropped. Everything else in
// the picture, including the orientation, is kept. An Exif block that cannot be parsed is dropped
// whole. A PDF is stored as it is.

import { crc32 } from 'node:zlib';

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const GPS_IFD = 0x8825;
const EXIF_HEAD = Buffer.from('Exif\0\0', 'latin1');
const XMP_HEAD = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

/**
 * Zeroes the GPS directory of the TIFF data that starts at `tiff` inside an Exif block (in place);
 * false when the structure is odd. A JPEG's block starts with "Exif\0\0"; a PNG's or WebP's may not.
 */
function wipeGps(app1: Buffer, tiff = EXIF_HEAD.length): boolean {
  if (app1.length < tiff + 8) return false;
  const little = app1.toString('latin1', tiff, tiff + 2) === 'II';
  // 'MM' is the TIFF big-endian byte-order mark, not Myanmar.
  // eslint-disable-next-line no-restricted-syntax
  if (!little && app1.toString('latin1', tiff, tiff + 2) !== 'MM') return false;
  const u16 = (o: number) => (little ? app1.readUInt16LE(o) : app1.readUInt16BE(o));
  const u32 = (o: number) => (little ? app1.readUInt32LE(o) : app1.readUInt32BE(o));
  const inside = (o: number, n: number) => o >= 0 && n >= 0 && o + n <= app1.length;
  const ifd0 = tiff + u32(tiff + 4);
  if (!inside(ifd0, 2)) return false;
  const n0 = u16(ifd0);
  if (!inside(ifd0 + 2, n0 * 12)) return false;
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== GPS_IFD) continue;
    const gps = tiff + u32(e + 8);
    if (!inside(gps, 2)) return false;
    const n = u16(gps);
    if (!inside(gps + 2, n * 12)) return false;
    for (let k = 0; k < n; k++) {
      const g = gps + 2 + k * 12;
      const size = (TYPE_SIZE[u16(g + 2)] ?? 1) * u32(g + 4);
      if (size > 4) {
        const at = tiff + u32(g + 8);
        if (!inside(at, size)) return false;
        app1.fill(0, at, at + size);
      }
    }
    app1.fill(0, gps, gps + 2 + n * 12 + 4); // an empty directory: zero entries, no next IFD
  }
  return true;
}

/** Where the TIFF data of an Exif block starts: after "Exif\0\0" when a writer kept that head. */
const tiffStart = (exif: Buffer) =>
  exif.subarray(0, EXIF_HEAD.length).equals(EXIF_HEAD) ? EXIF_HEAD.length : 0;

/** The photo without GPS (and without XMP, which can repeat it). A PDF or unknown bytes pass through. */
export function stripGps(bytes: Buffer): Buffer {
  switch (sniffMime(bytes)) {
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/png':
      return stripPng(bytes);
    case 'image/webp':
      return stripWebp(bytes);
    default:
      return bytes;
  }
}

function stripJpeg(jpeg: Buffer): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const out: Buffer[] = [jpeg.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break; // image data follows
    const len = jpeg.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > jpeg.length) break;
    const seg = Buffer.from(jpeg.subarray(i, end));
    const payload = seg.subarray(4);
    if (marker === 0xe1 && payload.subarray(0, EXIF_HEAD.length).equals(EXIF_HEAD)) {
      if (wipeGps(payload)) out.push(seg);
      // else: dropped whole
    } else if (marker === 0xe1 && payload.subarray(0, XMP_HEAD.length).equals(XMP_HEAD)) {
      // dropped
    } else {
      out.push(seg);
    }
    i = end;
  }
  out.push(jpeg.subarray(i));
  return Buffer.concat(out);
}

/** PNG text chunks that carry XMP or a whole Exif block ("Raw profile type exif" from ImageMagick). */
const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt']);
const placeText = (keyword: string) =>
  keyword === 'XML:com.adobe.xmp' || keyword.startsWith('Raw profile type');

/**
 * A PNG's eXIf chunk loses its GPS directory (with a new CRC) and the text chunks holding XMP or a raw
 * Exif profile are dropped; other chunks are copied as they are. Unchanged bytes come back as given.
 */
function stripPng(png: Buffer): Buffer {
  const out: Buffer[] = [png.subarray(0, 8)];
  let changed = false;
  let i = 8;
  while (i + 12 <= png.length) {
    const len = png.readUInt32BE(i);
    const end = i + 12 + len;
    if (end > png.length) break;
    const type = png.toString('latin1', i + 4, i + 8);
    if (type === 'eXIf') {
      changed = true;
      const chunk = Buffer.from(png.subarray(i, end));
      const data = chunk.subarray(8, 8 + len);
      if (wipeGps(data, tiffStart(data))) {
        chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + len)), 8 + len);
        out.push(chunk);
      }
    } else if (PNG_TEXT.has(type)) {
      const data = png.subarray(i + 8, i + 8 + len);
      const nul = data.indexOf(0);
      if (placeText(data.toString('latin1', 0, nul < 0 ? data.length : nul))) changed = true;
      else out.push(png.subarray(i, end));
    } else {
      out.push(png.subarray(i, end));
    }
    i = end;
    if (type === 'IEND') break;
  }
  if (!changed) return png;
  out.push(png.subarray(i));
  return Buffer.concat(out);
}

/** VP8X flag bits (WebP container spec): the file has an EXIF chunk, an XMP chunk. */
const WEBP_EXIF = 0x08;
const WEBP_XMP = 0x04;

/**
 * A WebP's EXIF chunk loses its GPS directory and its "XMP " chunk is dropped; the VP8X flags and the
 * RIFF size follow. Unchanged bytes come back as given.
 */
function stripWebp(webp: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from(webp.subarray(0, 12))];
  let changed = false;
  let drop = 0;
  let i = 12;
  while (i + 8 <= webp.length) {
    const fourcc = webp.toString('latin1', i, i + 4);
    const size = webp.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > webp.length) break;
    const chunk = Buffer.from(webp.subarray(i, Math.min(end, webp.length)));
    if (fourcc === 'EXIF') {
      changed = true;
      const data = chunk.subarray(8, 8 + size);
      if (wipeGps(data, tiffStart(data))) out.push(chunk);
      else drop |= WEBP_EXIF;
    } else if (fourcc === 'XMP ') {
      changed = true;
      drop |= WEBP_XMP;
    } else {
      out.push(chunk);
    }
    i = end;
  }
  if (!changed) return webp;
  if (i < webp.length) out.push(webp.subarray(i));
  for (const c of out.slice(1)) {
    if (c.toString('latin1', 0, 4) === 'VP8X' && c.length > 8) c[8] = c[8]! & ~drop;
  }
  const all = Buffer.concat(out);
  all.writeUInt32LE(all.length - 8, 4);
  return all;
}

/** What the bytes say they are; the declared content type must agree. */
export function sniffMime(
  b: Buffer,
): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    b.length >= 12 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
