import type { ModuleRegistry, RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createEarningsRepository,
  createGoalRepository,
  createProcessingRepository,
  createSettingsRepository,
  totalOf,
  type Db,
  type GoalRow,
} from '../db';
import { ProblemError } from '../errors';
import { goalProgress } from '../goal-progress';
import { localDate } from '../time';
import { createEarningsPolicy } from './earnings';
import { idParams, str, strictObject } from './util';

const fields = {
  label: str(1, 60),
  metric: { enum: ['earnings', 'hours', 'shifts', 'active_distance'] },
  period: { enum: ['daily', 'weekly', 'monthly', 'yearly'] },
  target: { type: 'integer', minimum: 1, maximum: 1_000_000_000 },
  active: { type: 'boolean' },
};
const createBody = strictObject(fields, ['label', 'metric', 'period', 'target']);
const patchBody = strictObject(fields, [], { minProperties: 1 });

/** A goal with its progress now (also used by the notification triggers). */
export function goalViewer({
  db,
  now,
  registry,
  override,
}: {
  db: Db;
  now: () => number;
  registry: ModuleRegistry;
  override?: 'replace' | 'sum';
}) {
  const settings = createSettingsRepository(db);
  const processing = createProcessingRepository(db);
  const earnings = createEarningsRepository(db);
  return (userId: number, g: GoalRow) => {
    const prefs = settings.get(userId);
    const policy = createEarningsPolicy(db, registry, override);
    const progress = goalProgress(
      g,
      localDate(now(), prefs?.timezone ?? 'UTC'),
      prefs?.weekStart ?? 1,
      {
        earningsCents: (from, to) => {
          if (!policy.any(userId)) return null;
          const rows = earnings.effective(userId, from, to, policy.options(userId));
          return rows.length === 0 ? null : rows.reduce((a, r) => a + totalOf(r), 0);
        },
        shifts: (from, to) =>
          processing.shiftsInPeriod(userId, from, to).map((s) => ({
            ms: (s.endedAt ?? s.startedAt) - s.startedAt,
            activeM: s.activeM,
            segmenter: s.segmenter,
          })),
      },
    );
    return {
      id: g.id,
      label: g.label,
      metric: g.metric,
      period: g.period,
      target: g.target,
      active: g.active === 1,
      created_at: g.createdAt,
      progress,
    };
  };
}

/** Module `goals` (18 section 8.1). A device may read goals (the ring on the phone, later); only the web changes them. */
export function goalsRoutes({
  db,
  now,
  authn,
  override,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  override?: 'replace' | 'sum';
}) {
  return (host: RouteHost) => {
    const { app, registry, bus } = host as ServerRouteHost;
    const repo = createGoalRepository(db);

    const view = goalViewer({ db, now, registry, override });
    const mine = (userId: number, id: number) => {
      const g = repo.find(userId, id);
      if (!g) throw new ProblemError('not_found', 'No such goal.');
      return g;
    };

    app.get('/goals', async (req) => {
      const { userId } = authn.authenticate(req, 'SD');
      return repo.list(userId).map((g) => view(userId, g));
    });

    app.post('/goals', { schema: { body: createBody } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = req.body as Pick<GoalRow, 'label' | 'metric' | 'period' | 'target'> & {
        active?: boolean;
      };
      const g = repo.create({
        userId,
        label: b.label.trim(),
        metric: b.metric,
        period: b.period,
        target: b.target,
        active: b.active === false ? 0 : 1,
        createdAt: now(),
      });
      bus.emit('goals.changed', { userId: String(userId) });
      return reply.status(201).send(view(userId, g));
    });

    app.patch('/goals/:id', { schema: { params: idParams, body: patchBody } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      mine(userId, id);
      const { active, ...rest } = req.body as Partial<GoalRow> & { active?: boolean };
      const g = repo.update(userId, id, {
        ...rest,
        ...(active === undefined ? {} : { active: active ? 1 : 0 }),
      })!;
      bus.emit('goals.changed', { userId: String(userId) });
      return view(userId, g);
    });

    app.delete('/goals/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      mine(userId, id);
      repo.delete(userId, id);
      bus.emit('goals.changed', { userId: String(userId) });
      return reply.status(204).send();
    });
  };
}
