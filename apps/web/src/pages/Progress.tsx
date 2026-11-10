import { PageHeader, Section } from '../ui/layout';
import { describe } from '../api/client';
import { useApiQuery } from '../api/query';
import { formatDateTime, formatMoney } from '../format';
import { useSettings } from '../session';
import { FormError } from '../ui/form';

/** Progress (module `progress`, off by default): level, streak, weekly challenges, badges. Derived, never typed in. */
export function ProgressPage() {
  const { currency, timezone } = useSettings();
  const asked = useApiQuery('/progress');
  const p = asked.data;
  const error = asked.error ? describe(asked.error) : null;
  if (!p) return <FormError message={error} />;
  const show = (id: string, v: number) => (id === 'earn' ? formatMoney(v, currency) : String(v));
  return (
    <section className="space-y-6">
      <PageHeader title="Progress" />
      <FormError message={error} />
      <div className="space-y-3 rounded-medium bg-card p-5 sm:max-w-md">
        <p className="text-headline-large text-on-surface">Level {p.level}</p>
        <div
          role="progressbar"
          aria-label="XP to next level"
          aria-valuenow={p.xp_into_level}
          aria-valuemin={0}
          aria-valuemax={p.xp_per_level}
          className="h-2 overflow-hidden rounded-full bg-secondary-container"
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
              className={`rounded-medium border p-3 text-body-medium ${b.unlocked_at ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface-variant'}`}
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
