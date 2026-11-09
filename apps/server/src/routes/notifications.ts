import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { type Db } from '../db';
import { ProblemError } from '../errors';
import type { DriverContexts } from '../driver-context';
import { evaluate, PREFS, prefsOf } from '../notifications';
import { idParams, str, strictObject } from './util';

const listQuery = strictObject(
  {
    unread: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    cursor: str(1, 100),
  },
  [],
);
const patchBody = strictObject({ read: { type: 'boolean' } }, ['read']);
const prefsBody = strictObject(Object.fromEntries(PREFS.map((p) => [p, { type: 'boolean' }])), [], {
  minProperties: 1,
});

interface Row {
  id: number;
  kind: string;
  dedupeKey: string;
  bodyKey: string;
  createdAt: number;
  readAt: number | null;
}
const COLUMNS =
  'id, kind, dedupe_key AS dedupeKey, body_key AS bodyKey, created_at AS createdAt, read_at AS readAt';
const view = (r: Row) => ({
  id: r.id,
  kind: r.kind,
  body_key: r.bodyKey,
  // what the message is about (a date, an id): the client builds the text from kind, body_key and this
  ref: r.dedupeKey.slice(r.kind.length + 1),
  created_at: r.createdAt,
  read_at: r.readAt,
});

/** Module `notifications` (18 section 11): the inbox and its toggles. A device may read; only the web changes. */
export function notificationsRoutes({
  db,
  now,
  authn,
  drivers,
  taxCountries,
  override,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  drivers: DriverContexts;
  taxCountries: readonly string[];
  override?: 'replace' | 'sum';
}) {
  return ({ app, registry }: ServerRouteHost) => {
    app.get('/notifications', { schema: { querystring: listQuery } }, async (req) => {
      const { userId } = authn.authenticate(req, 'SD');
      evaluate({ db, now, drivers, registry, taxCountries, override }, userId);
      const q = req.query as { unread?: boolean; limit?: number; cursor?: string };
      const limit = q.limit ?? 50;
      let before = Number.MAX_SAFE_INTEGER;
      if (q.cursor) {
        const decoded = Buffer.from(q.cursor, 'base64url').toString();
        before = Number(decoded);
        if (!/^\d+$/.test(decoded)) {
          throw new ProblemError('validation_failed', 'The request is not valid.', [
            { path: '/cursor', message: 'is not a cursor from this server' },
          ]);
        }
      }
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM notifications WHERE user_id = ? AND dismissed_at IS NULL AND id < ? ${q.unread ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ${limit + 1}`,
        )
        .all(userId, before) as Row[];
      const page = rows.slice(0, limit);
      return {
        items: page.map(view),
        next_cursor:
          rows.length > limit ? Buffer.from(String(page.at(-1)!.id)).toString('base64url') : null,
        unread_count: db
          .prepare(
            'SELECT count(*) FROM notifications WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL',
          )
          .pluck()
          .get(userId),
      };
    });

    app.get('/notifications/prefs', async (req) => {
      const { userId } = authn.authenticate(req, 'SD');
      return prefsOf(db, userId);
    });

    app.patch('/notifications/prefs', { schema: { body: prefsBody } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = req.body as Record<string, boolean>;
      db.prepare('INSERT OR IGNORE INTO notification_prefs (user_id) VALUES (?)').run(userId);
      for (const [k, v] of Object.entries(b)) {
        db.prepare(`UPDATE notification_prefs SET ${k} = ? WHERE user_id = ?`).run(
          v ? 1 : 0,
          userId,
        );
      }
      return prefsOf(db, userId);
    });

    app.patch(
      '/notifications/:id',
      { schema: { params: idParams, body: patchBody } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const id = (req.params as { id: number }).id;
        const read = (req.body as { read: boolean }).read;
        const info = db
          .prepare(
            'UPDATE notifications SET read_at = CASE WHEN ? THEN coalesce(read_at, ?) ELSE NULL END WHERE user_id = ? AND id = ?',
          )
          .run(read ? 1 : 0, now(), userId, id);
        if (info.changes === 0) throw new ProblemError('not_found', 'No such notification.');
        return view(db.prepare(`SELECT ${COLUMNS} FROM notifications WHERE id = ?`).get(id) as Row);
      },
    );

    app.delete('/notifications/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const info = db
        .prepare(
          'UPDATE notifications SET dismissed_at = ? WHERE user_id = ? AND id = ? AND dismissed_at IS NULL',
        )
        .run(now(), userId, (req.params as { id: number }).id);
      if (info.changes === 0) throw new ProblemError('not_found', 'No such notification.');
      return reply.status(204).send();
    });
  };
}
