import { useEffect, useState } from 'react';
import { PageHeader, Section } from '../ui/layout';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime, formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';

type P = Schemas['Progress'];

/** Progress (module `progress`, off by default): level, streak, weekly challenges, badges. Derived, never typed in. */
export function ProgressPage() {
  const { api } = useSession();
  const { currency, timezone } = useSettings();
  const [p, setP] = useState<P | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void unwrap<P>(api.GET('/progress'))
      .then(setP)
      .catch((e) => setError(describe(e)));
  }, [api]);
  if (!p) return <FormError message={error} />;
  const show = (id: string, v: number) => (id === 'earn' ? formatMoney(v, currency) : String(v));
  return (
    <section className="space-y-6">
      <PageHeader title="Progress" />
      <FormError message={error} />
      <div className="space-y-3 rounded-xl border bg-card p-5 sm:max-w-md">
        <p className="text-3xl font-semibold tracking-tight">Level {p.level}</p>
        <div
          role="progressbar"
          aria-label="XP to next level"
          aria-valuenow={p.xp_into_level}
          aria-valuemin={0}
          aria-valuemax={p.xp_per_level}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-2 rounded-full bg-primary"
            style={{ width: `${(p.xp_into_level / p.xp_per_level) * 100}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {p.xp} XP in total, {p.xp_per_level - p.xp_into_level} to the next level.
        </p>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2">
        <Section label="Streak" title="Streak">
          <p>
            {p.streak.days} {p.streak.days === 1 ? 'day' : 'days'} in a row, {p.streak.freezes_held}{' '}
            {p.streak.freezes_held === 1 ? 'freeze' : 'freezes'} held.
          </p>
          {p.streak.at_risk ? (
            <p className="text-sm text-muted-foreground">
              No shift yet today: work one to keep the streak.
            </p>
          ) : null}
        </Section>
        <Section label="Weekly challenges" title="This week">
          <ul className="divide-y text-sm">
            {p.challenges.map((c) => (
              <li key={c.id} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <span>{c.label}</span>
                <span className={c.done ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {c.done
                    ? 'done'
                    : c.value === null
                      ? 'nothing entered yet'
                      : `${show(c.id, c.value)} of ${show(c.id, c.target)}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section label="Badges" title="Badges">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {p.badges.map((b) => (
            <li
              key={b.slug}
              className={`rounded-lg border p-3 text-sm ${b.unlocked_at ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'}`}
            >
              {b.label}
              <span className="block text-xs">
                {b.unlocked_at ? formatDateTime(b.unlocked_at, timezone) : 'locked'}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
