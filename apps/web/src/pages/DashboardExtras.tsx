import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Circle, CircleCheck, DatabaseBackup, Flag, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { levelWord, useCountries } from '../countries';
import { useSession, useSettings } from '../session';
import { valueText } from './Goals';
import { messageOf } from './Notifications';

const PERIOD_WORD: Record<string, string> = {
  daily: "Today's goal",
  weekly: 'Weekly goal',
  monthly: 'Monthly goal',
  yearly: 'Yearly goal',
};

/**
 * The goal card of the dashboard (Comma's weekly goal card, 18 section 13): the first active
 * goal, how far along it is as a share and a meter, and the streak when the progress module runs.
 * Nothing appears without a goal; the checklist offers to set one. A failed request hides it.
 */
export function GoalRing() {
  const { api } = useSession();
  const { modules, distance_unit: unit, currency } = useSettings();
  const [goal, setGoal] = useState<Schemas['Goal'] | null>(null);
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    void unwrap<Schemas['Goal'][]>(api.GET('/goals'))
      .then((list) => setGoal(list.find((g) => g.active) ?? null))
      .catch(() => setGoal(null));
    if (modules.progress)
      void unwrap(api.GET('/progress'))
        .then((p) => setStreak(p.streak.days))
        .catch(() => setStreak(0));
  }, [api, modules.progress]);
  if (!goal) return null;
  const p = goal.progress;
  const pct = p.ratio === null ? null : Math.round(p.ratio * 100);
  const text = (v: number) => valueText(goal.metric, v, unit, currency);
  return (
    <Card role="group" aria-label="Goal">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {PERIOD_WORD[goal.period] ?? 'Goal'}
            </p>
            <h2 className="truncate text-base font-medium">{goal.label}</h2>
          </div>
          <p className="text-2xl font-semibold tabular-nums">{pct === null ? '—' : `${pct}%`}</p>
        </div>
        <div
          role="progressbar"
          aria-label={`${goal.label} progress`}
          aria-valuenow={pct ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-primary/20"
        >
          <div
            className="h-2 rounded-full bg-primary"
            style={{ width: `${Math.min(100, pct ?? 0)}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {p.value === null
            ? (p.note ?? 'Progress unknown')
            : `${text(p.value)} of ${text(p.target)}${p.estimated ? ' (estimated)' : ''}`}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {streak > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {streak}-day streak
            </Badge>
          ) : (
            <span />
          )}
          <Link to="/goals" className="text-sm font-medium underline underline-offset-4">
            Open Goals
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

interface Item {
  id: string;
  text: string;
  visible: boolean;
  done: () => Promise<boolean>;
}

/**
 * "Finish setting up" (18 section 13): done or not from server state, only for the modules that
 * are on, gone when everything visible is done. If any answer cannot be read the card stays
 * hidden rather than guess.
 */
export function SetupChecklist() {
  const { api } = useSession();
  const { modules } = useSettings();
  const [state, setState] = useState<{ text: string; done: boolean }[] | null>(null);

  useEffect(() => {
    const items: Item[] = [
      {
        id: 'platforms',
        text: 'Add your other apps',
        visible: modules.platforms,
        done: async () =>
          (
            await unwrap<Schemas['Platform'][]>(
              api.GET('/platforms', { params: { query: { include_inactive: true } } }),
            )
          ).some((p) => p.custom),
      },
      {
        id: 'vehicle',
        text: 'Add your real vehicle',
        visible: true,
        done: async () => (await unwrap<Schemas['Vehicle'][]>(api.GET('/vehicles'))).length > 0,
      },
      {
        id: 'goal',
        text: 'Set a weekly goal',
        visible: modules.goals,
        done: async () =>
          (await unwrap<Schemas['Goal'][]>(api.GET('/goals'))).some((g) => g.period === 'weekly'),
      },
      {
        id: 'phone',
        text: 'Pair your phone',
        visible: modules.devices,
        done: async () =>
          (await unwrap<Schemas['Device'][]>(api.GET('/devices'))).some(
            (d) => d.revoked_at === null,
          ),
      },
      {
        id: 'backup',
        text: 'Run a backup',
        visible: true,
        done: async () => (await unwrap<Schemas['Backup'][]>(api.GET('/backups'))).length > 0,
      },
    ].filter((i) => i.visible);
    let live = true;
    void Promise.all(items.map(async (i) => ({ text: i.text, done: await i.done() })))
      .then((r) => live && setState(r))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [api, modules.platforms, modules.goals, modules.devices]);

  if (!state || state.every((i) => i.done)) return null;
  const done = state.filter((i) => i.done).length;
  return (
    <Card role="group" aria-label="Finish setting up">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-medium">Finish setting up</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {done} of {state.length}
          </span>
        </div>
        <ul className="space-y-2 text-sm">
          {state.map((i) => (
            <li key={i.text} className="flex items-center gap-3">
              {i.done ? (
                <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-earned" />
              ) : (
                <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={i.done ? 'text-muted-foreground line-through' : ''}>{i.text}</span>
              <span className="sr-only">{i.done ? ' (done)' : ' (not done)'}</span>
            </li>
          ))}
        </ul>
        <Button asChild size="sm">
          <Link to="/onboarding">Continue setup</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Alert role="note" className="border-primary/40 bg-primary/5">
      {icon}
      <AlertDescription className="text-foreground">{children}</AlertDescription>
    </Alert>
  );
}

const linkClass = 'font-medium underline underline-offset-4';

/**
 * One-line notices under the greeting (Comma's banners), each with where to act: the region
 * prompt (owner decision Q4, plan 21), shifts of the last 30 days with checks to review, and a
 * failed or overdue backup from the notifications module. Unreadable answers show nothing.
 */
export function Notices({ today }: { today: string }) {
  const { api } = useSession();
  const { country, region, modules } = useSettings();
  const c = useCountries().find((x) => x.code === country);
  const [review, setReview] = useState(0);
  const [backup, setBackup] = useState<string | null>(null);
  useEffect(() => {
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    void unwrap(api.GET('/shifts', { params: { query: { from, to: today, limit: 200 } } }))
      .then((p) =>
        setReview(p.items.filter((s) => s.flags?.some((f) => f.severity === 'review')).length),
      )
      .catch(() => setReview(0));
    if (modules.notifications)
      void unwrap(api.GET('/notifications', { params: { query: { unread: true, limit: 50 } } }))
        .then((p) => {
          const n = p.items.find((i) => i.kind === 'backup_failed' || i.kind === 'backup_overdue');
          setBackup(n ? messageOf(n) : null);
        })
        .catch(() => setBackup(null));
  }, [api, today, modules.notifications]);
  const word = c?.regional_rules && !region ? levelWord(c).toLowerCase() : null;
  return (
    <>
      {word ? (
        <Notice icon={<MapPin />}>
          Set your {word} to include its own rules. Until then, only the national rules apply.{' '}
          <Link to="/settings/general" className={linkClass}>
            Set your {word}
          </Link>
        </Notice>
      ) : null}
      {review > 0 ? (
        <Notice icon={<Flag />}>
          {review === 1 ? '1 shift' : `${review} shifts`} from the last 30 days{' '}
          {review === 1 ? 'has' : 'have'} checks to review.{' '}
          <Link to="/shifts" className={linkClass}>
            Review shifts
          </Link>
        </Notice>
      ) : null}
      {backup ? (
        <Notice icon={<DatabaseBackup />}>
          {backup}{' '}
          <Link to="/backups" className={linkClass}>
            Open Backups
          </Link>
        </Notice>
      ) : null}
    </>
  );
}
