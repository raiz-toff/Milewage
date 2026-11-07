import { useEffect, useState } from 'react';
import { Circle, CircleCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { levelWord, useCountries } from '../countries';
import { useSession, useSettings } from '../session';
import { GoalBar } from './Goals';

/**
 * The goal ring of the dashboard (18 section 13): the first active goal's progress. Nothing
 * appears without a goal; the checklist offers to set one. A failed request just hides it.
 */
export function GoalRing() {
  const { api } = useSession();
  const [goal, setGoal] = useState<Schemas['Goal'] | null>(null);
  useEffect(() => {
    void unwrap<Schemas['Goal'][]>(api.GET('/goals'))
      .then((list) => setGoal(list.find((g) => g.active) ?? null))
      .catch(() => setGoal(null));
  }, [api]);
  return goal ? (
    <Card role="group" aria-label="Goal">
      <CardContent className="space-y-3">
        <h2 className="text-base font-medium">Goal</h2>
        <GoalBar goal={goal} />
      </CardContent>
    </Card>
  ) : null;
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

/** Owner decision Q4 (plan 21): while the country has regional rules and no region is set. */
export function RegionPrompt() {
  const { country, region } = useSettings();
  const c = useCountries().find((x) => x.code === country);
  if (!c?.regional_rules || region) return null;
  const word = levelWord(c).toLowerCase();
  return (
    <Alert role="note">
      <AlertDescription>
        <span>
          Set your {word} to include its own rules. Until then, only the national rules apply.{' '}
          <Link to="/settings/general" className="font-medium underline underline-offset-4">
            Set your {word}
          </Link>
        </span>
      </AlertDescription>
    </Alert>
  );
}
