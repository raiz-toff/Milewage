import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Authenticator } from '../auth/authenticator';
import type { Db } from '../db';
import { ProblemError } from '../errors';
import { sniffMime, stripGps } from '../receipts/exif';

/** Plan 25 section 7: a platform's logo is a small picture, never a document. */
export const LOGO_MAX_BYTES = 256 * 1024;
const MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type Mime = (typeof MIMES)[number];

/** The version of a platform's logo for `GET /platforms` (changes with the bytes); null: none. */
export function logoVersion(db: Db, userId: number, slug: string): string | null {
  const sha = db
    .prepare('SELECT sha256 FROM platform_logos WHERE user_id = ? AND slug = ?')
    .pluck()
    .get(userId, slug) as string | undefined;
  return sha ? sha.slice(0, 16) : null;
}

export const deleteLogo = (db: Db, userId: number, slug: string) =>
  db.prepare('DELETE FROM platform_logos WHERE user_id = ? AND slug = ?').run(userId, slug);

/**
 * `PUT|GET|DELETE /platforms/{slug}/logo` (plan 25 section 7), in their own plugin so the image
 * body parser and its 256 KB limit apply here only (the receipts module has its own). Follows the
 * OWASP file upload rules: PNG, JPEG or WebP only, checked by their first bytes as well as the
 * declared type; no SVG (it can carry script); no file name or path from the driver (the row is
 * keyed by the driver and the slug); JPEG location data removed as for receipts; served with
 * `nosniff` and a sandboxing CSP.
 */
export function platformLogoRoutes(
  app: FastifyInstance,
  {
    db,
    authn,
    now,
    known,
  }: {
    db: Db;
    authn: Authenticator;
    now: () => number;
    known: (userId: number, slug: string) => boolean;
  },
) {
  void app.register(async (child) => {
    child.removeAllContentTypeParsers();
    child.addContentTypeParser(
      [...MIMES],
      { parseAs: 'buffer', bodyLimit: LOGO_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );
    const params = {
      type: 'object',
      additionalProperties: false,
      required: ['slug'],
      properties: { slug: { type: 'string', pattern: '^[a-z0-9_]{1,32}$' } },
    };
    const slugOf = (req: { params: unknown }) => (req.params as { slug: string }).slug;
    const mine = (userId: number, slug: string) => {
      if (!known(userId, slug)) throw new ProblemError('not_found', 'No such platform.');
    };

    child.put(
      '/platforms/:slug/logo',
      { schema: { params }, bodyLimit: LOGO_MAX_BYTES },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        const slug = slugOf(req);
        mine(userId, slug);
        const declared = String(req.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim();
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0 || !MIMES.includes(declared as Mime)) {
          throw new ProblemError('unsupported_media_type', 'Use a PNG, JPEG or WebP image.');
        }
        if (sniffMime(body) !== declared) {
          throw new ProblemError('validation_failed', 'The file is not what its type says.', [
            { path: '/', message: `is not a ${declared} file` },
          ]);
        }
        const bytes = declared === 'image/jpeg' ? stripGps(body) : body;
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const had = logoVersion(db, userId, slug) !== null;
        db.prepare(
          `INSERT INTO platform_logos (user_id, slug, mime, bytes, sha256, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, slug) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes,
             sha256 = excluded.sha256, updated_at = excluded.updated_at`,
        ).run(userId, slug, declared, bytes, sha256, now());
        return reply
          .status(had ? 200 : 201)
          .send({ slug, mime: declared, bytes: bytes.length, logo_version: sha256.slice(0, 16) });
      },
    );

    child.get('/platforms/:slug/logo', { schema: { params } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'SD');
      const slug = slugOf(req);
      mine(userId, slug);
      const row = db
        .prepare('SELECT mime, bytes FROM platform_logos WHERE user_id = ? AND slug = ?')
        .get(userId, slug) as { mime: Mime; bytes: Buffer } | undefined;
      if (!row) throw new ProblemError('not_found', 'This platform has no logo.');
      // Like every API answer it is sent `no-store` (hooks.ts); `?v=` in the web's address only
      // marks a new image after a change.
      return reply
        .header('Content-Type', row.mime)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Disposition', 'inline')
        .send(row.bytes);
    });

    child.delete('/platforms/:slug/logo', { schema: { params } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const slug = slugOf(req);
      mine(userId, slug);
      deleteLogo(db, userId, slug);
      return reply.status(204).send();
    });
  });
}
