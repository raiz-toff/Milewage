import { useEffect, useState } from 'react';
import { unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { GoalRing, RegionPrompt, SetupChecklist } from './DashboardExtras';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, Section } from '../ui/layout';
import { DashboardHero } from './DashboardHero';
import { ShiftCard } from './Shifts';

const DAY = 86_400_000;

/** A calendar date YYYY-MM-DD in the instance time zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(new Date(ms));
}

export interface Period {
  id: string;
  label: string;
  range: (now: number, timeZone: string, weekStart?: number) => { from: string; to: string };
}

export const PERIODS: Period[] = [
  {
    id: '30d',
    label: '30 days',
    range: (now, tz) => ({ from: localDate(now - 29 * DAY, tz), to: localDate(now, tz) }),
  },
  {
    id: 'month',
    label: 'Month',
    range: (now, tz) => {
      const to = localDate(now, tz);
      return { from: `${to.slice(0, 7)}-01`, to };
    },
  },
  {
    id: 'today',
    label: 'Today',
    range: (now, tz) => ({ from: localDate(now, tz), to: localDate(now, tz) }),
  },
  {
    id: 'week',
    label: 'Week',
    range: (now, tz, weekStart = 1) => {
      const to = localDate(now, tz);
      const t = Date.parse(`${to}T00:00:00Z`);
      const back = (new Date(t).getUTCDay() - weekStart + 7) % 7;
      return { from: new Date(t - back * DAY).toISOString().slice(0, 10), to };
    },
  },
  {
    id: 'year',
    label: 'Year',
    range: (now, tz) => {
      const to = localDate(now, tz);
      return { from: `${to.slice(0, 4)}-01-01`, to };
    },
  },
];

/** The latest few shifts, as on the Shifts page. Hidden when they cannot be read. */
function RecentShifts() {
  const { api } = useSession();
  const settings = useSettings();
  const [rows, setRows] = useState<Schemas['Shift'][] | null>(null);
  useEffect(() => {
    let live = true;
    void unwrap(api.GET('/shifts', { params: { query: { limit: 5 } } }))
      .then((p) => live && setRows(p.items))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [api]);
  if (!rows) return null;
  return (
    <Section
      title="Recent shifts"
      label="Recent shifts"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link to="/shifts">View all</Link>
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No shifts yet. Shifts start on the phone.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id}>
              <ShiftCard shift={s} settings={settings} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** "Good afternoon, Sam" and the date, both in the driver's time zone (Comma's header). */
function Greeting({ now }: { now: number }) {
  const { display_name: name, timezone } = useSettings();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
  return <PageHeader title={`Good ${part}${name ? `, ${name}` : ''}`} description={date} />;
}

/**
 * The dashboard, laid out like the Comma phone app's Home: greeting, the earnings hero with its
 * tiles and deduction tip, then setup, goal and the latest shifts. Only data MileWage has.
 */
export function Dashboard({ now }: { now?: number }) {
  const settings = useSettings();
  const at = now ?? Date.now();
  const [period, setPeriod] = useState('week');
  return (
    <section className="space-y-6">
      <Greeting now={at} />
      <RegionPrompt />
      <DashboardHero now={at} period={period} onPeriod={setPeriod} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SetupChecklist />
        {settings.modules.goals ? <GoalRing /> : null}
      </div>
      <RecentShifts />
    </section>
  );
}
