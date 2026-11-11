import { useEffect, useState } from 'react';
import { ProgressRing } from '../ui/visuals';
import type { ReactNode } from 'react';
import {
  BackupsIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CircleIcon,
  ExpandMoreIcon,
  FlagIcon,
  LocationIcon,
} from '@/ui/icons';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Schemas } from '../api/client';
import { useApiQuery, useChange } from '../api/query';
import { levelWord, useCountries } from '../countries';
import { addDays } from '../days';
import { settingsPatch, useSettings } from '../session';
import { valueText } from '../goals';
import { formatDateTime } from '../format';
import { reviewCount } from '../shift/view';

const PERIOD_WORD: Record<string, string> = {
  daily: "Today's goal",
  weekly: 'Weekly goal',
  monthly: 'Monthly goal',
  yearly: 'Yearly goal',
};

/**
 * The goal card of the dashboard (Comma's weekly goal card, 18 section 13): the first active
 * goal and how far along it is as a share and a meter.
 * Nothing appears without a goal; the checklist offers to set one. A failed request hides it.
 */
export function GoalRing() {
  const { distance_unit: unit, currency } = useSettings();
  const goal = useApiQuery('/goals').data?.find((g) => g.active) ?? null;
  if (!goal) return null;
  const p = goal.progress;
  const pct = p.ratio === null ? null : Math.round(p.ratio * 100);
  const text = (v: number) => valueText(goal.metric, v, unit, currency);
  return (
    <Card role="group" aria-label="Goal">
      <CardContent className="space-y-3">
        {/* The goal as a ring that fills, green with a tick once it is reached. */}
        <div className="flex items-center gap-4">
          <div
            role="progressbar"
            aria-label={`${goal.label} progress`}
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            className="shrink-0"
          >
            <ProgressRing value={pct ?? 0} size={84} done={pct !== null && pct >= 100}>
              {pct === null ? '—' : `${pct}%`}
            </ProgressRing>
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-label-medium text-on-surface-variant">
              {PERIOD_WORD[goal.period] ?? 'Goal'}
            </p>
            <h2 className="truncate text-title-medium">{goal.label}</h2>
            <p className="text-body-medium text-muted-foreground tabular-nums">
              {p.value === null
                ? (p.note ?? 'Progress unknown')
                : `${text(p.value)} of ${text(p.target)}${p.estimated ? ' (estimated)' : ''}`}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Link to="/goals" className={cn(linkClass, 'text-label-large')}>
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

/** An inline link: on-surface text over the primary underline the `link` button draws. */
const linkClass =
  'rounded-extra-small text-foreground underline decoration-primary decoration-2 underline-offset-4 focus-ring hover:decoration-[3px]';

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
  // Keeping a step is quiet: a failure only means it is kept on a later visit.
  const { run } = useChange();
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

  const keep = (ids: SetupStep[]) => run(...settingsPatch({ setup_done: ids }));
  // Steps done now but not yet kept are kept, so they stay done whatever happens later.
  const fresh = (live ?? [])
    .filter((i) => i.done && !kept.includes(i.id as SetupStep))
    .map((i) => i.id as SetupStep);
  const freshKey = fresh.join();
  useEffect(() => {
    if (freshKey) void keep(freshKey.split(',') as SetupStep[]);
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
      <p className="text-body-medium text-muted-foreground">
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
            <h2 className="text-title-medium">Finish setting up</h2>
            <p className="text-body-medium text-muted-foreground tabular-nums">
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
          className="h-2 overflow-hidden rounded-full bg-secondary-container"
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
              className={`flex items-center gap-1 rounded-medium ${n === 0 ? 'bg-surface-container-highest' : ''}`}
            >
              <Link
                to={i.to}
                className="relative flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-medium px-2 py-2 state-layer focus-ring"
              >
                <CircleIcon className="size-5 shrink-0 text-on-surface-variant" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-body-large">
                    {i.text}
                    {n === 0 ? <Badge variant="secondary">Next</Badge> : null}
                  </span>
                  <span className="block text-body-small text-muted-foreground">{i.why}</span>
                </span>
                <ChevronRightIcon
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
                  onClick={() => void keep([i.id as SetupStep])}
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
              className="flex items-center gap-1 rounded-small text-label-large text-muted-foreground focus-ring hover:text-foreground"
            >
              <ExpandMoreIcon
                aria-hidden="true"
                className={`size-4 transition-transform motion-reduce:transition-none ${showDone ? '' : '-rotate-90'}`}
              />
              {done.length} done
            </button>
            {showDone ? (
              <ul className="mt-2 space-y-1 text-body-medium text-muted-foreground">
                {done.map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <CheckCircleIcon className="size-5 shrink-0 text-primary" />
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

function Notice({
  icon,
  children,
  variant,
}: {
  icon: ReactNode;
  children: ReactNode;
  variant?: 'destructive';
}) {
  return (
    <Alert role="note" variant={variant}>
      {icon}
      <AlertDescription className={variant ? undefined : 'text-foreground'}>
        {children}
      </AlertDescription>
    </Alert>
  );
}

/** No verified backup for this long is overdue: the nightly run has been missed at least once. */
const BACKUP_OVERDUE_MS = 36 * 3_600_000;

/**
 * One-line notices under the greeting (Comma's banners), each with where to act: the region
 * prompt (owner decision Q4, plan 21), shifts of the last 30 days with checks to review, and a
 * failed or overdue backup from the system status. Unreadable answers show nothing.
 */
export function Notices({ today, now }: { today: string; now: number }) {
  const { country, region, timezone, time_format: tf } = useSettings();
  const c = useCountries().find((x) => x.code === country);
  const from = addDays(today, -29);
  const shifts = useApiQuery('/shifts', { params: { query: { from, to: today, limit: 200 } } });
  const review = shifts.data?.items.filter((s) => reviewCount(s) > 0).length ?? 0;
  const status = useApiQuery('/system/status').data;
  // The last run failed and none has succeeded since; else the newest verified backup is old.
  const failed = status?.last_backup_failure ?? null;
  const last = status?.last_backup ?? null;
  const overdue = !failed && last !== null && now - last.created_at > BACKUP_OVERDUE_MS;
  const word = c?.regional_rules && !region ? levelWord(c).toLowerCase() : null;
  return (
    <>
      {word ? (
        <Notice icon={<LocationIcon />}>
          Set your {word} to include its own rules. Until then, only the national rules apply.{' '}
          <Link to="/settings/general" className={linkClass}>
            Set your {word}
          </Link>
        </Notice>
      ) : null}
      {review > 0 ? (
        <Notice icon={<FlagIcon />}>
          {review === 1 ? '1 shift' : `${review} shifts`} from the last 30 days{' '}
          {review === 1 ? 'has' : 'have'} checks to review.{' '}
          <Link to="/shifts" className={linkClass}>
            Review shifts
          </Link>
        </Notice>
      ) : null}
      {failed ? (
        <Notice icon={<BackupsIcon />} variant="destructive">
          The last backup failed on {formatDateTime(failed.at, timezone, tf)}. Older backups are
          kept.{' '}
          <Link to="/backups" className={linkClass}>
            Open Backups
          </Link>
        </Notice>
      ) : overdue ? (
        <Notice icon={<BackupsIcon />}>
          No successful backup in the last day and a half.{' '}
          <Link to="/backups" className={linkClass}>
            Open Backups
          </Link>
        </Notice>
      ) : null}
    </>
  );
}
