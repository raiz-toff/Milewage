import { useEffect, useState } from 'react';
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
      <h1 className="font-heading text-2xl">Progress</h1>
      <FormError message={error} />
      <div className="max-w-md space-y-1">
        <p className="text-lg">Level {p.level}</p>
        <div
          role="progressbar"
          aria-label="XP to next level"
          aria-valuenow={p.xp_into_level}
          aria-valuemin={0}
          aria-valuemax={p.xp_per_level}
          className="h-2 rounded bg-line"
        >
          <div
            className="h-2 rounded bg-accent"
            style={{ width: `${(p.xp_into_level / p.xp_per_level) * 100}%` }}
          />
        </div>
        <p className="text-sm text-muted">
          {p.xp} XP in total, {p.xp_per_level - p.xp_into_level} to the next level.
        </p>
      </div>
      <section aria-label="Streak" className="space-y-1">
        <h2 className="font-heading text-lg">Streak</h2>
        <p>
          {p.streak.days} {p.streak.days === 1 ? 'day' : 'days'} in a row, {p.streak.freezes_held}{' '}
          {p.streak.freezes_held === 1 ? 'freeze' : 'freezes'} held.
        </p>
        {p.streak.at_risk ? (
          <p className="text-sm text-muted">No shift yet today: work one to keep the streak.</p>
        ) : null}
      </section>
      <section aria-label="Weekly challenges" className="space-y-2">
        <h2 className="font-heading text-lg">This week</h2>
        <ul className="max-w-md space-y-1">
          {p.challenges.map((c) => (
            <li key={c.id} className="flex justify-between">
              <span>{c.label}</span>
              <span className={c.done ? 'text-accent' : 'text-muted'}>
                {c.done
                  ? 'done'
                  : c.value === null
                    ? 'nothing entered yet'
                    : `${show(c.id, c.value)} of ${show(c.id, c.target)}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Badges" className="space-y-2">
        <h2 className="font-heading text-lg">Badges</h2>
        <ul className="grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3">
          {p.badges.map((b) => (
            <li
              key={b.slug}
              className={`rounded border p-2 text-sm ${b.unlocked_at ? 'border-accent' : 'border-line text-muted'}`}
            >
              {b.label}
              <span className="block text-xs">
                {b.unlocked_at ? formatDateTime(b.unlocked_at, timezone) : 'locked'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
