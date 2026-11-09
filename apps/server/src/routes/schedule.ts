import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createVehicleRepository, type Db } from '../db';
import { ProblemError } from '../errors';
import { platformKnown } from './platforms';
import { idParams, strictObject } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const time = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };
const plan = {
  start_time: time,
  end_time: time,
  platform: { type: ['string', 'null'], pattern: '^[a-z0-9_]{1,32}$' },
  vehicle_id: { type: ['integer', 'null'], minimum: 1 },
};
const entryCreate = strictObject({ planned_on: date, ...plan, remind: { type: 'boolean' } }, [
  'planned_on',
  'start_time',
  'end_time',
]);
const entryPatch = strictObject({ planned_on: date, ...plan, remind: { type: 'boolean' } }, [], {
  minProperties: 1,
});
const tplFields = {
  label: { type: 'string', minLength: 1, maxLength: 60 },
  weekdays: { type: 'integer', minimum: 1, maximum: 127 },
  ...plan,
  active: { type: 'boolean' },
};
const tplCreate = strictObject(tplFields, ['label', 'weekdays', 'start_time', 'end_time']);
const tplPatch = strictObject(tplFields, [], { minProperties: 1 });
const range = strictObject({ from: date, to: date }, ['from', 'to']);
const offBody = strictObject({ note: { type: ['string', 'null'], maxLength: 200 } }, []);
const offParams = strictObject({ date }, ['date']);
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const valid = (d: string) => Number.isFinite(ms(d)) && new Date(ms(d)).toISOString().startsWith(d);
/** Bit 0 is Monday ... bit 6 is Sunday (18 section 9). */
export const weekdayBit = (d: string) => 1 << ((new Date(ms(d)).getUTCDay() + 6) % 7);

const ENTRY =
  'id, planned_on, start_time, end_time, platform, vehicle_id, template_id, shift_id, remind';
const TPL = 'id, label, weekdays, start_time, end_time, platform, vehicle_id, active';

/** Module `schedule` (18 section 9), off by default. The server stores the plan; the phone fires reminders itself. */
export function scheduleRoutes({ db, authn }: { db: Db; authn: Authenticator }) {
  return ({ app, registry }: ServerRouteHost) => {
    const vehicles = createVehicleRepository(db);

    const bad = (path: string, message: string) =>
      new ProblemError('validation_failed', 'The plan is not valid.', [{ path, message }]);
    const check = (
      userId: number,
      b: { planned_on?: string; platform?: string | null; vehicle_id?: number | null },
    ) => {
      if (b.planned_on !== undefined && !valid(b.planned_on))
        throw bad('/planned_on', 'is not a calendar date');
      if (b.vehicle_id != null && !vehicles.find(userId, b.vehicle_id))
        throw bad('/vehicle_id', 'is not one of your vehicles');
      if (b.platform && registry.isEnabled('platforms') && !platformKnown(db, userId, b.platform)) {
        throw bad('/platform', 'is not one of your platforms');
      }
    };
    const entry = (userId: number, id: number) =>
      db
        .prepare(`SELECT ${ENTRY} FROM schedule_entries WHERE user_id = ? AND id = ?`)
        .get(userId, id) as Record<string, unknown> | undefined;
    const template = (userId: number, id: number) =>
      db
        .prepare(`SELECT ${TPL} FROM schedule_templates WHERE user_id = ? AND id = ?`)
        .get(userId, id) as Record<string, unknown> | undefined;
    const entryView = (r: Record<string, unknown>) => ({ ...r, remind: r.remind === 1 });
    const tplView = (r: Record<string, unknown>) => ({ ...r, active: r.active === 1 });
    const need = <T>(row: T | undefined, what: string): T => {
      if (!row) throw new ProblemError('not_found', `No such ${what}.`);
      return row;
    };
    const set = (table: string, userId: number, id: number, b: Record<string, unknown>) => {
      const cols = Object.keys(b);
      db.prepare(
        `UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE user_id = @userId AND id = @id`,
      ).run({
        ...Object.fromEntries(
          cols.map((c) => [c, typeof b[c] === 'boolean' ? (b[c] ? 1 : 0) : b[c]]),
        ),
        userId,
        id,
      });
    };
    const clash = (e: unknown) => {
      if (String(e).includes('UNIQUE'))
        throw bad('/start_time', 'a shift is already planned at that time');
      throw e;
    };

    app.get('/schedule', { schema: { querystring: range } }, async (req) => {
      const { userId } = authn.authenticate(req, 'SD');
      const { from, to } = req.query as { from: string; to: string };
      if (!valid(from) || !valid(to) || to < from || (ms(to) - ms(from)) / DAY > 366)
        throw bad('/from', 'give a valid range of at most a year');
      // A planned day the driver worked is linked to that day's shift (by date; never required).
      db.prepare(
        `UPDATE schedule_entries SET shift_id = (SELECT s.id FROM shifts s WHERE s.user_id = schedule_entries.user_id
           AND s.local_date = schedule_entries.planned_on AND s.status <> 'active' ORDER BY s.started_at LIMIT 1)
         WHERE user_id = ? AND shift_id IS NULL AND planned_on BETWEEN ? AND ?`,
      ).run(userId, from, to);
      return {
        entries: (
          db
            .prepare(
              `SELECT ${ENTRY} FROM schedule_entries WHERE user_id = ? AND planned_on BETWEEN ? AND ? ORDER BY planned_on, start_time`,
            )
            .all(userId, from, to) as Record<string, unknown>[]
        ).map(entryView),
        off_days: db
          .prepare(
            'SELECT off_on, note FROM schedule_off_days WHERE user_id = ? AND off_on BETWEEN ? AND ? ORDER BY off_on',
          )
          .all(userId, from, to),
        templates: (
          db
            .prepare(`SELECT ${TPL} FROM schedule_templates WHERE user_id = ? ORDER BY id`)
            .all(userId) as Record<string, unknown>[]
        ).map(tplView),
      };
    });

    app.post('/schedule/entries', { schema: { body: entryCreate } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = req.body as {
        planned_on: string;
        start_time: string;
        end_time: string;
        platform?: string | null;
        vehicle_id?: number | null;
        remind?: boolean;
      };
      check(userId, b);
      try {
        const id = db
          .prepare(
            'INSERT INTO schedule_entries (user_id, planned_on, start_time, end_time, platform, vehicle_id, remind) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            userId,
            b.planned_on,
            b.start_time,
            b.end_time,
            b.platform ?? null,
            b.vehicle_id ?? null,
            b.remind === false ? 0 : 1,
          ).lastInsertRowid;
        return reply.status(201).send(entryView(entry(userId, Number(id))!));
      } catch (e) {
        return clash(e);
      }
    });
    app.patch(
      '/schedule/entries/:id',
      { schema: { params: idParams, body: entryPatch } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const id = (req.params as { id: number }).id;
        need(entry(userId, id), 'planned shift');
        const b = req.body as Record<string, unknown>;
        check(userId, b);
        try {
          set('schedule_entries', userId, id, b);
        } catch (e) {
          clash(e);
        }
        return entryView(entry(userId, id)!);
      },
    );
    app.delete('/schedule/entries/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      need(entry(userId, id), 'planned shift');
      db.prepare('DELETE FROM schedule_entries WHERE id = ?').run(id);
      return reply.status(204).send();
    });

    app.post('/schedule/templates', { schema: { body: tplCreate } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = req.body as {
        label: string;
        weekdays: number;
        start_time: string;
        end_time: string;
        platform?: string | null;
        vehicle_id?: number | null;
      };
      check(userId, b);
      const id = db
        .prepare(
          'INSERT INTO schedule_templates (user_id, label, weekdays, start_time, end_time, platform, vehicle_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          userId,
          b.label.trim(),
          b.weekdays,
          b.start_time,
          b.end_time,
          b.platform ?? null,
          b.vehicle_id ?? null,
        ).lastInsertRowid;
      return reply.status(201).send(tplView(template(userId, Number(id))!));
    });
    app.patch(
      '/schedule/templates/:id',
      { schema: { params: idParams, body: tplPatch } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const id = (req.params as { id: number }).id;
        need(template(userId, id), 'template');
        const b = req.body as Record<string, unknown>;
        check(userId, b);
        set('schedule_templates', userId, id, b);
        return tplView(template(userId, id)!);
      },
    );
    app.delete('/schedule/templates/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      need(template(userId, id), 'template');
      db.prepare('DELETE FROM schedule_templates WHERE id = ?').run(id); // its entries stay, unlinked
      return reply.status(204).send();
    });

    app.post('/schedule/expand', { schema: { body: range } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const { from, to } = req.body as { from: string; to: string };
      if (!valid(from) || !valid(to) || to < from || (ms(to) - ms(from)) / DAY > 366)
        throw bad('/from', 'give a valid range of at most a year');
      const tpls = db
        .prepare(`SELECT ${TPL} FROM schedule_templates WHERE user_id = ? AND active = 1`)
        .all(userId) as {
        id: number;
        weekdays: number;
        start_time: string;
        end_time: string;
        platform: string | null;
        vehicle_id: number | null;
      }[];
      const off = new Set(
        db
          .prepare('SELECT off_on FROM schedule_off_days WHERE user_id = ?')
          .pluck()
          .all(userId) as string[],
      );
      const insert = db.prepare(
        'INSERT OR IGNORE INTO schedule_entries (user_id, planned_on, start_time, end_time, platform, vehicle_id, template_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      let created = 0;
      db.transaction(() => {
        for (let t = ms(from); t <= ms(to); t += DAY) {
          const d = new Date(t).toISOString().slice(0, 10);
          if (off.has(d)) continue;
          for (const p of tpls) {
            if ((p.weekdays & weekdayBit(d)) === 0) continue;
            created += insert.run(
              userId,
              d,
              p.start_time,
              p.end_time,
              p.platform,
              p.vehicle_id,
              p.id,
            ).changes;
          }
        }
      })();
      return { created };
    });

    app.put(
      '/schedule/off-days/:date',
      { schema: { params: offParams, body: offBody } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const d = (req.params as { date: string }).date;
        if (!valid(d)) throw bad('/date', 'is not a calendar date');
        const note = (req.body as { note?: string | null } | undefined)?.note ?? null;
        db.prepare(
          'INSERT INTO schedule_off_days (user_id, off_on, note) VALUES (?, ?, ?) ON CONFLICT (user_id, off_on) DO UPDATE SET note = excluded.note',
        ).run(userId, d, note);
        return { off_on: d, note };
      },
    );
    app.delete(
      '/schedule/off-days/:date',
      { schema: { params: offParams } },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        db.prepare('DELETE FROM schedule_off_days WHERE user_id = ? AND off_on = ?').run(
          userId,
          (req.params as { date: string }).date,
        );
        return reply.status(204).send();
      },
    );
  };
}
