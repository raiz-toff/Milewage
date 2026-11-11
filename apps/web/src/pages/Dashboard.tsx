import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AddIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import { PERIODS, dayOf } from '../days';
import { useSettings } from '../session';
import { Notices, SetupChecklist } from './DashboardExtras';
import { PageHeader } from '../ui/layout';
import { DashboardHero } from './DashboardHero';
import { RecentShifts } from './DashboardShifts';
import { PeriodBreakdown } from './DashboardTrend';
import type { PeriodId } from './DashboardTrend';

/**
 * "Good afternoon, Sam" and the date, both in the driver's time zone (Comma's header), with the
 * one thing Comma's bottom bar does that the web also does: add an expense.
 */
function Greeting({ now }: { now: number }) {
  const { display_name: name, timezone, modules } = useSettings();
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
  return (
    <PageHeader title={`Good ${part}${name ? `, ${name}` : ''}`} description={date}>
      {modules.expenses ? (
        <Button asChild variant="outline">
          <Link to="/expenses?new">
            <AddIcon />
            Add expense
          </Link>
        </Button>
      ) : null}
    </PageHeader>
  );
}

/**
 * The dashboard, laid out like the Comma phone app's Home: greeting, the earnings hero with its
 * tiles and deduction tip, then setup and the latest shifts. Only data MileWage has.
 */
export function Dashboard({ now }: { now?: number }) {
  const settings = useSettings();
  const at = now ?? Date.now();
  const [period, setPeriod] = useState('week');
  const [ref, wide] = useWide(896);
  const hero = <DashboardHero now={at} period={period} onPeriod={setPeriod} />;
  const today = dayOf(at, settings.timezone);
  // The second chart: where the period's money (or miles) came from. Nothing when there is no split.
  const breakdown = (
    <PeriodBreakdown
      id={period as PeriodId}
      range={PERIODS.find((p) => p.id === period)!.range(today, settings.week_start)}
      today={today}
    />
  );
  return (
    <section ref={ref} className="space-y-6">
      <Greeting now={at} />
      <div className="space-y-3 empty:hidden">
        <Notices today={today} now={at} />
      </div>
      {wide ? (
        // Wide: setup and the breakdown form a side column; without both, the main one takes it all.
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-6 has-[>[data-side]:empty]:grid-cols-1">
          <div className="min-w-0 space-y-6">
            {hero}
            <RecentShifts />
          </div>
          <div data-side="" className="space-y-4 empty:hidden">
            <SetupChecklist />
            {breakdown}
          </div>
        </div>
      ) : (
        // Narrow: one column with setup first while it is unfinished.
        <div className="space-y-6">
          <SetupChecklist />
          {hero}
          {breakdown}
          <RecentShifts />
        </div>
      )}
    </section>
  );
}

/** Whether the element is at least `px` wide (the sidebar takes part of the window). */
function useWide(px: number) {
  const ref = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A little slack going back, so a scroll bar coming and going cannot flip it back and forth.
    const check = () => setWide((was) => el.clientWidth >= (was ? px - 24 : px));
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [px]);
  return [ref, wide] as const;
}
