import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  DatabaseBackup,
  Flag,
  MapPin,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useApiQuery } from '../api/query';
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
  const { modules, distance_unit: unit, currency } = useSettings();
  const goal = useApiQuery('/goals').data?.find((g) => g.active) ?? null;
  const progress = useApiQuery('/progress', undefined, { enabled: modules.progress }).data;
  const streak = modules.progress ? (progress?.streak.days ?? 0) : 0;
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
  /** One line on why it is worth doing. */
  why: string;
  /** Where it is done. */
  to: string;
  visible: boolean;
  /** Can be skipped: a goal or a backup is the driver's choice, not needed to record shifts. */
  optional?: boolean;
  /** Undefined while the answer is not in (or could not be read). */
  done: boolean | undefined;
}
type Step = Pick<Item, 'id' | 'text' | 'why' | 'to' | 'optional'> & { done: boolean };
type SetupStep = Schemas['SetupStep'];

const linkClass = 'font-medium underline underline-offset-4';

const HIDDEN_KEY = 'mw-setup-hidden';
/** "Hide for now" is kept per browser; storage can be blocked, which just means not hidden. */
function storedHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}
function storeHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Not stored: hidden until the page is opened again.
  }
}

/**
 * "Finish setting up" (18 section 13, plan 23 section 4.4): done or not from server state, only
 * for the modules that are on, gone when everything visible is done. Onboarding-checklist
 * practice: progress shown, the next step first and marked, every step a link to where it is
 * done with why it matters, finished steps folded away, and "Hide for now" that can be undone.
 * If any answer cannot be read the card stays hidden rather than guess. Apps are chosen in the
 * setup wizard, so turning platforms on is not a step here (W4c). A step seen done, or skipped,
 * is kept on the server (`setup_done`) and stays done: deleting the goal later does not bring
 * the card back (W8).
 */
export function SetupChecklist() {
  const { api, setSettings } = useSession();
  const { modules, setup_done: kept } = useSettings();
  const vehicles = useApiQuery('/vehicles').data;
  const goals = useApiQuery('/goals', undefined, { enabled: modules.goals }).data;
  const devices = useApiQuery('/devices', undefined, { enabled: modules.devices }).data;
  const backups = useApiQuery('/backups').data;
  const items: Item[] = [
    {
      id: 'vehicle',
      text: 'Add your real vehicle',
      why: 'So your logbook and deduction use the right vehicle.',
      to: '/vehicles',
      visible: true,
      done: vehicles && vehicles.length > 0,
    },
    {
      id: 'goal',
      text: 'Set a weekly goal',
      why: 'See how far along the week you are.',
      to: '/goals',
      visible: modules.goals,
      optional: true,
      done: goals?.some((g) => g.period === 'weekly'),
    },
    {
      id: 'phone',
      text: 'Pair your phone',
      why: 'The phone records your shifts.',
      to: '/devices',
      visible: modules.devices,
      done: devices?.some((d) => d.revoked_at === null),
    },
    {
      id: 'backup',
      text: 'Run a backup',
      why: 'A copy of your data you can restore.',
      to: '/backups',
      visible: true,
      optional: true,
      done: backups && backups.length > 0,
    },
  ].filter((i) => i.visible);
  const live: Step[] | null = items.some((i) => i.done === undefined)
    ? null
    : items.map(({ id, text, why, to, optional, done }) => ({
        id,
        text,
        why,
        to,
        optional,
        done: !!done,
      }));
  const state =
    live && live.map((i) => ({ ...i, done: i.done || kept.includes(i.id as SetupStep) }));
  const [hidden, setHidden] = useState(storedHidden);
  const [showDone, setShowDone] = useState(false);

  const keep = (ids: SetupStep[]) =>
    unwrap(api.PATCH('/settings', { body: { setup_done: ids } })).then(setSettings);
  // Steps done now but not yet kept are kept, so they stay done whatever happens later.
  const fresh = (live ?? [])
    .filter((i) => i.done && !kept.includes(i.id as SetupStep))
    .map((i) => i.id as SetupStep);
  const freshKey = fresh.join();
  useEffect(() => {
    if (freshKey) keep(freshKey.split(',') as SetupStep[]).catch(() => undefined);
  }, [freshKey]);

  if (!state || state.every((i) => i.done)) return null;
  const open = state.filter((i) => !i.done);
  const done = state.filter((i) => i.done);
  const hide = (h: boolean) => {
    storeHidden(h);
    setHidden(h);
  };
  if (hidden)
    return (
      <p className="text-sm text-muted-foreground">
        Setup steps hidden ({open.length} left).{' '}
        <button type="button" className={linkClass} onClick={() => hide(false)}>
          Show them
        </button>
      </p>
    );
  return (
    <Card role="group" aria-label="Finish setting up">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h2 className="text-base font-medium">Finish setting up</h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {done.length} of {state.length} done
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2"
            onClick={() => hide(true)}
          >
            Hide for now
          </Button>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuenow={done.length}
          aria-valuemin={0}
          aria-valuemax={state.length}
          className="h-2 overflow-hidden rounded-full bg-primary/20"
        >
          <div
            className="h-2 rounded-full bg-primary"
            style={{ width: `${(done.length / state.length) * 100}%` }}
          />
        </div>
        <ul className="-mx-2 space-y-1">
          {open.map((i, n) => (
            <li
              key={i.id}
              className={`flex items-center gap-1 rounded-lg border ${n === 0 ? 'border-primary/50 bg-primary/10' : 'border-transparent'}`}
            >
              <Link
                to={i.to}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {i.text}
                    {n === 0 ? <Badge>Next</Badge> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{i.why}</span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Link>
              {i.optional ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mr-1 text-muted-foreground"
                  aria-label={`Skip: ${i.text}`}
                  onClick={() => void keep([i.id as SetupStep]).catch(() => undefined)}
                >
                  Skip
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {done.length > 0 ? (
          <div>
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone(!showDone)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition-transform motion-reduce:transition-none ${showDone ? '' : '-rotate-90'}`}
              />
              {done.length} done
            </button>
            {showDone ? (
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {done.map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-earned" />
                    {i.text}
                    <span className="sr-only"> (done)</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
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

/**
 * One-line notices under the greeting (Comma's banners), each with where to act: the region
 * prompt (owner decision Q4, plan 21), shifts of the last 30 days with checks to review, and a
 * failed or overdue backup from the notifications module. Unreadable answers show nothing.
 */
export function Notices({ today }: { today: string }) {
  const { country, region, modules } = useSettings();
  const c = useCountries().find((x) => x.code === country);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const shifts = useApiQuery('/shifts', { params: { query: { from, to: today, limit: 200 } } });
  const review =
    shifts.data?.items.filter((s) => s.flags?.some((f) => f.severity === 'review')).length ?? 0;
  const unread = useApiQuery(
    '/notifications',
    { params: { query: { unread: true, limit: 50 } } },
    { enabled: modules.notifications },
  ).data;
  const failed = modules.notifications
    ? unread?.items.find((i) => i.kind === 'backup_failed' || i.kind === 'backup_overdue')
    : undefined;
  const backup = failed ? messageOf(failed) : null;
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
