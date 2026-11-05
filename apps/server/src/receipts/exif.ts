// Receipt photos may carry the place they were taken (01 section 2, privacy). The server removes
// the GPS data of a JPEG before storing it (18 section 5.4). Everything else in the picture,
// including the orientation, is kept. An Exif block that cannot be parsed is dropped whole.

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const GPS_IFD = 0x8825;
const EXIF_HEAD = Buffer.from('Exif\0\0', 'latin1');
const XMP_HEAD = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

/** Zeroes the GPS directory inside an Exif APP1 payload (in place); false when the structure is odd. */
function wipeGps(app1: Buffer): boolean {
  const tiff = EXIF_HEAD.length;
  if (app1.length < tiff + 8) return false;
  const little = app1.toString('latin1', tiff, tiff + 2) === 'II';
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

/** The JPEG without GPS (and without XMP, which can repeat it). Other formats pass through unchanged. */
export function stripGps(jpeg: Buffer): Buffer {
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
