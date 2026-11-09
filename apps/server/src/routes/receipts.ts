import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createExpenseRepository, type Db } from '../db';
import { ProblemError } from '../errors';
import { sniffMime, stripGps } from '../receipts/exif';
import { receiptsDirOf } from '../receipts/store';
import { idParams } from './util';

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
/** All receipts together; the volume's own free-space rules (10 section 11.3) still apply on top. */
export const RECEIPT_TOTAL_BYTES = 2 * 1024 ** 3;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const EXT: Record<(typeof MIMES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

interface ReceiptRow {
  file: string;
  mime: (typeof MIMES)[number];
  bytes: number;
  sha256: string;
  createdAt: number;
}

/** Module `receipts` (18 section 5.4), a sub-module of `expenses`. Web session only. */
export function receiptsRoutes({
  db,
  now,
  authn,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
}) {
  return ({ app }: ServerRouteHost) => {
    const dir = receiptsDirOf(db);
    const expenses = createExpenseRepository(db);
    // Binary bodies: the global limit is 64 KiB, so these types carry their own.
    app.addContentTypeParser(
      [...MIMES],
      { parseAs: 'buffer', bodyLimit: RECEIPT_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );
    const row = (id: number) =>
      db
        .prepare(
          'SELECT file, mime, bytes, sha256, created_at AS createdAt FROM expense_receipts WHERE expense_id = ?',
        )
        .get(id) as ReceiptRow | undefined;
    const view = (id: number, r: ReceiptRow) => ({
      expense_id: id,
      mime: r.mime,
      bytes: r.bytes,
      sha256: r.sha256,
      created_at: r.createdAt,
    });
    const mine = (userId: number, id: number) => {
      if (!expenses.find(userId, id)) throw new ProblemError('not_found', 'No such expense.');
    };

    app.put(
      '/expenses/:id/receipt',
      { schema: { params: idParams }, bodyLimit: RECEIPT_MAX_BYTES },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        const id = (req.params as { id: number }).id;
        mine(userId, id);
        const declared = String(req.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim();
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0 || !MIMES.includes(declared as never)) {
          throw new ProblemError('unsupported_media_type', 'Send a JPEG, PNG, WebP or PDF file.');
        }
        if (sniffMime(body) !== declared) {
          throw new ProblemError('validation_failed', 'The file is not what its type says.', [
            { path: '/', message: `is not a ${declared} file` },
          ]);
        }
        const bytes = stripGps(body); // a PDF passes through
        const used = db
          .prepare('SELECT coalesce(sum(bytes), 0) FROM expense_receipts WHERE expense_id <> ?')
          .pluck()
          .get(id) as number;
        if (used + bytes.length > RECEIPT_TOTAL_BYTES) {
          throw new ProblemError('insufficient_storage', 'The receipt store is full.');
        }
        const mime = declared as (typeof MIMES)[number];
        const file = `${randomUUID()}.${EXT[mime]}`;
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, `${file}.part`), bytes, { mode: 0o600 });
        renameSync(join(dir, `${file}.part`), join(dir, file)); // never a half file under its name
        const old = row(id);
        const saved: ReceiptRow = {
          file,
          mime,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          createdAt: now(),
        };
        db.prepare(
          `INSERT INTO expense_receipts (user_id, expense_id, file, mime, bytes, sha256, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (expense_id) DO UPDATE SET file = excluded.file, mime = excluded.mime,
             bytes = excluded.bytes, sha256 = excluded.sha256, created_at = excluded.created_at`,
        ).run(userId, id, saved.file, saved.mime, saved.bytes, saved.sha256, saved.createdAt);
        if (old) rmSync(join(dir, old.file), { force: true });
        return reply.status(old ? 200 : 201).send(view(id, saved));
      },
    );

    app.get('/expenses/:id/receipt', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      mine(userId, id);
      const r = row(id);
      if (!r || !existsSync(join(dir, r.file))) {
        throw new ProblemError('not_found', 'This expense has no receipt.');
      }
      return reply
        .header('Content-Type', r.mime)
        .header('Content-Length', r.bytes)
        .header('Content-Disposition', 'inline')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(createReadStream(join(dir, r.file)));
    });

    app.delete('/expenses/:id/receipt', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      mine(userId, id);
      const r = row(id);
      if (r) {
        db.prepare('DELETE FROM expense_receipts WHERE expense_id = ?').run(id);
        rmSync(join(dir, r.file), { force: true });
      }
      return reply.status(204).send();
    });
  };
}
