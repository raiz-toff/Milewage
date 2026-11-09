import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildBackupService, createRestoreService, fileSecrets } from '../src/index';
import { sniffMime, stripGps } from '../src/receipts/exif';
import { harness, type Harness } from './support';

// 18 section 5.4: receipt files, GPS stripping, and the backup that carries them.
let h: Harness;
let cookie: string;
let key: string;
beforeEach(async () => {
  h = harness();
  ({ cookie, recoveryKey: key } = await h.signUp());
});
afterEach(() => h.close());

/** TIFF data with Orientation in IFD0 and a GPS directory with a latitude. */
function gpsTiff(): Buffer {
  const tiff = Buffer.alloc(80);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 at 8
  tiff.writeUInt16BE(2, 8); // two entries
  tiff.writeUInt16BE(0x0112, 10); // Orientation = 6, a SHORT held in the entry
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(6, 18);
  tiff.writeUInt16BE(0x8825, 22); // GPS IFD pointer -> 38
  tiff.writeUInt16BE(4, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt32BE(38, 30);
  tiff.writeUInt32BE(0, 34); // next IFD
  tiff.writeUInt16BE(1, 38); // GPS: one entry, GPSLatitude as three rationals at 56
  tiff.writeUInt16BE(0x0002, 40);
  tiff.writeUInt16BE(5, 42);
  tiff.writeUInt32BE(3, 44);
  tiff.writeUInt32BE(56, 48);
  tiff.writeUInt32BE(0, 52);
  for (let i = 0; i < 6; i++) tiff.writeUInt32BE(0x11223344 + i, 56 + i * 4); // recognisable bytes
  return tiff;
}

/** A tiny JPEG with an Exif block holding `gpsTiff`. */
function jpegWithGps(): Buffer {
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), gpsTiff()]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exif]);
  app1.writeUInt16BE(app1.length - 2, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]),
  ]);
}
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20, 7),
]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

const XMP = Buffer.from('<x:xmpmeta><exif:GPSLatitude>51,30.0N</exif:GPSLatitude></x:xmpmeta>');
const LAT = Buffer.from([0x11, 0x22, 0x33, 0x44]);

/** A PNG chunk with its CRC. */
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
/** A PNG with an eXIf chunk (GPS inside), XMP in an iTXt chunk, a plain comment and the image. */
function pngWithGps(): Buffer {
  return Buffer.concat([
    PNG.subarray(0, 8),
    pngChunk('IHDR', Buffer.alloc(13, 1)),
    pngChunk('eXIf', gpsTiff()),
    pngChunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), XMP])),
    pngChunk('tEXt', Buffer.from('Comment\0fuel at the corner', 'latin1')),
    pngChunk('IDAT', Buffer.from([9, 9, 9])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A WebP chunk, padded to an even length. */
function webpChunk(fourcc: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
}
/** An extended WebP: VP8X flagging Exif and XMP, the image, an EXIF chunk (GPS inside) and XMP. */
function webpWithGps(): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04;
  const body = Buffer.concat([
    webpChunk('VP8X', vp8x),
    webpChunk('VP8 ', Buffer.from([1, 2, 3])),
    webpChunk('EXIF', Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), gpsTiff()])),
    webpChunk('XMP ', XMP),
  ]);
  const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([head, body]);
}

/** The chunk types of a PNG, in order; throws on a bad CRC. */
function pngTypes(png: Buffer): string[] {
  const types: string[] = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    const crc = crc32(png.subarray(i + 4, i + 8 + len));
    if (png.readUInt32BE(i + 8 + len) !== crc) throw new Error('bad CRC');
    types.push(png.toString('latin1', i + 4, i + 8));
    i += 12 + len;
  }
  return types;
}

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const expense = async () =>
  (
    await send('POST', '/expenses', {
      spent_on: '2027-01-10',
      category: 'fuel',
      amount_cents: 5000,
    })
  ).json().id as number;
const upload = (id: number, body: Buffer, type: string) =>
  h.app.inject({
    method: 'PUT',
    url: `/api/v1/expenses/${id}/receipt`,
    payload: body,
    headers: { 'content-type': type, cookie, origin: 'http://mw.test', host: 'mw.test' },
  });
const files = () =>
  existsSync(join(h.dir, 'receipts')) ? readdirSync(join(h.dir, 'receipts')) : [];

describe('GPS removal', () => {
  test('the GPS directory is emptied, the orientation and the structure stay', () => {
    const before = jpegWithGps();
    expect(before.includes(Buffer.from([0x11, 0x22, 0x33, 0x44]))).toBe(true);
    const after = stripGps(before);
    expect(after.length).toBe(before.length);
    expect(after.includes(Buffer.from([0x11, 0x22, 0x33, 0x44]))).toBe(false);
    expect(after.includes(Buffer.from([0x01, 0x12, 0x00, 0x03]))).toBe(true); // Orientation entry kept
    expect(after.subarray(-9).equals(before.subarray(-9))).toBe(true); // image data untouched
  });

  test('an Exif block that cannot be read is dropped, and non-JPEG bytes pass through', () => {
    const broken = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0c]),
      Buffer.from('Exif\0\0XX', 'latin1'),
      Buffer.from([0xff, 0xd9]),
    ]);
    const out = stripGps(broken);
    expect(out.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
    expect(stripGps(PNG)).toBe(PNG);
    expect(stripGps(PDF)).toBe(PDF);
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(Buffer.from('hello'))).toBeNull();
  });

  test('a PNG loses the GPS of its eXIf chunk and its XMP; the orientation and a comment stay', () => {
    const before = pngWithGps();
    expect(before.includes(LAT)).toBe(true);
    const after = stripGps(before);
    expect(after.includes(LAT)).toBe(false);
    expect(after.includes(XMP)).toBe(false);
    expect(after.includes(Buffer.from([0x01, 0x12, 0x00, 0x03]))).toBe(true); // Orientation entry kept
    expect(pngTypes(after)).toEqual(['IHDR', 'eXIf', 'tEXt', 'IDAT', 'IEND']); // every CRC holds
    expect(after.includes(Buffer.from('fuel at the corner'))).toBe(true);
    // An eXIf chunk that cannot be read is dropped whole.
    const odd = Buffer.concat([
      PNG.subarray(0, 8),
      pngChunk('eXIf', Buffer.from('XX')),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    expect(pngTypes(stripGps(odd))).toEqual(['IEND']);
  });

  test('a WebP loses the GPS of its EXIF chunk and its XMP; the flags and the RIFF size follow', () => {
    const before = webpWithGps();
    expect(before.includes(LAT)).toBe(true);
    const after = stripGps(before);
    expect(sniffMime(after)).toBe('image/webp');
    expect(after.includes(LAT)).toBe(false);
    expect(after.includes(XMP)).toBe(false);
    expect(after.includes(Buffer.from('XMP ', 'latin1'))).toBe(false);
    expect(after.includes(Buffer.from([0x01, 0x12, 0x00, 0x03]))).toBe(true);
    expect(after.readUInt32LE(4)).toBe(after.length - 8);
    expect(after[20]).toBe(0x08); // VP8X: Exif still present, XMP gone
    expect(after.includes(Buffer.from([1, 2, 3]))).toBe(true); // image data untouched
  });
});

describe('upload, read, replace, delete', () => {
  test('a JPEG is stored without GPS; the row, the hash and the download agree', async () => {
    const id = await expense();
    const res = await upload(id, jpegWithGps(), 'image/jpeg');
    expect(res.statusCode).toBe(201);
    const stored = readFileSync(join(h.dir, 'receipts', files()[0]!));
    expect(stored.includes(Buffer.from([0x11, 0x22, 0x33, 0x44]))).toBe(false);
    expect(res.json()).toMatchObject({
      expense_id: id,
      mime: 'image/jpeg',
      bytes: stored.length,
      sha256: createHash('sha256').update(stored).digest('hex'),
    });
    const got = await send('GET', `/expenses/${id}/receipt`);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.rawPayload.equals(stored)).toBe(true);
    expect((await send('GET', `/expenses/${id}`)).json().has_receipt).toBe(true);
  });

  test('a PNG and a WebP are stored without GPS too', async () => {
    for (const [bytes, type] of [
      [pngWithGps(), 'image/png'],
      [webpWithGps(), 'image/webp'],
    ] as const) {
      const id = await expense();
      expect((await upload(id, bytes, type)).statusCode).toBe(201);
      const got = (await send('GET', `/expenses/${id}/receipt`)).rawPayload;
      expect(sniffMime(got)).toBe(type);
      expect(got.includes(LAT)).toBe(false);
      expect(got.includes(XMP)).toBe(false);
    }
  });

  test('replacing keeps one file; deleting the receipt or the expense removes the file', async () => {
    const id = await expense();
    await upload(id, PNG, 'image/png');
    const again = await upload(id, PDF, 'application/pdf');
    expect([again.statusCode, again.json().mime]).toEqual([200, 'application/pdf']);
    expect(files()).toHaveLength(1);
    expect((await send('DELETE', `/expenses/${id}/receipt`)).statusCode).toBe(204);
    expect(files()).toEqual([]);
    expect((await send('GET', `/expenses/${id}/receipt`)).statusCode).toBe(404);
    await upload(id, PNG, 'image/png');
    await send('DELETE', `/expenses/${id}`);
    expect(files()).toEqual([]);
  });

  test('refusals: wrong type, bytes that are not the declared type, too large, not yours', async () => {
    const id = await expense();
    expect((await upload(id, PNG, 'text/plain')).statusCode).toBe(415);
    const lie = await upload(id, PNG, 'image/jpeg');
    expect([lie.statusCode, lie.json().code]).toEqual([422, 'validation_failed']);
    const big = await upload(id, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'image/png');
    expect(big.statusCode).toBe(413);
    expect((await upload(99, PNG, 'image/png')).statusCode).toBe(404);
    expect(files()).toEqual([]);
    expect((await h.call('GET', `/expenses/${id}/receipt`)).statusCode).toBe(401);
  });

  test('the disk rules apply: writes are refused with 507 when the volume is nearly full', async () => {
    const id = await expense();
    h.volume.free = 10 * 1024 * 1024; // below the 200 MB line of 10 section 11.3
    const res = await upload(id, PNG, 'image/png');
    expect(res.statusCode).toBe(507);
  });
});

describe('backup and restore carry the receipts', () => {
  test('a backup of one instance restores the files on a fresh host and checks their hashes', async () => {
    const id = await expense();
    await upload(id, PNG, 'image/png');
    const original = readFileSync(join(h.dir, 'receipts', files()[0]!));
    const svc = (x: Harness) =>
      buildBackupService({
        db: x.db,
        now: () => x.clock.t,
        backupDir: join(x.dir, 'backups'),
        configDir: join(x.dir, 'config'),
      });
    const run = (await svc(h).run('manual'))!;
    const fresh = harness();
    try {
      const restore = createRestoreService({
        db: fresh.db,
        backup: svc(fresh),
        secrets: fileSecrets(join(fresh.dir, 'config')),
        state: fresh.state,
        receiptsDir: join(fresh.dir, 'receipts'),
      });
      await restore.restore(join(h.dir, 'backups', run.fileName), key, false);
      const got = readdirSync(join(fresh.dir, 'receipts'));
      expect(got).toHaveLength(1);
      expect(readFileSync(join(fresh.dir, 'receipts', got[0]!)).equals(original)).toBe(true);
      expect(fresh.db.prepare('SELECT count(*) FROM expense_receipts').pluck().get()).toBe(1);
      expect(
        fresh.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'receipt_blobs'").get(),
      ).toBeUndefined();
    } finally {
      await fresh.close();
    }
  });
});

describe('module off', () => {
  test('receipts off: routes 404, expenses still work, flag false', async () => {
    const off = harness({ receipts: false });
    try {
      const { cookie: c } = await off.signUp();
      const e = await off.call(
        'POST',
        '/expenses',
        { spent_on: '2027-01-10', category: 'fuel', amount_cents: 5 },
        { cookie: c },
      );
      expect(e.statusCode).toBe(201);
      expect(
        (await off.call('GET', '/expenses/1/receipt', undefined, { cookie: c })).statusCode,
      ).toBe(404);
      const flags = (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules;
      expect([flags.receipts, flags.expenses]).toEqual([false, true]);
    } finally {
      await off.close();
    }
  });
});
