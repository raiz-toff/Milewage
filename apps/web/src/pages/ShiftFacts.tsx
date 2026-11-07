import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { deductionWord, formatDistance, formatDuration, formatMoney } from '../format';
import { useSession } from '../session';
import { Section, StatCard } from '../ui/layout';

type Shift = Schemas['Shift'];

/** Plain words for the engine's flags (14 section 8). An unknown code is shown as it is. */
const FLAG_WORDS: Record<string, string> = {
  gap_counted: 'A signal gap was bridged and its distance counted.',
  gap_large: 'A long signal gap: some distance may be missing.',
  gap_dropped: 'A signal gap was too long to count.',
  tracking_interrupted: 'Tracking stopped or restarted on the phone.',
  shift_auto_closed: 'The shift was ended at the last position; it was never ended on the phone.',
  no_stops_detected: 'No stops changed the estimate, so the whole shift counts as one.',
  long_stop: 'A stop of 30 minutes or more.',
  label_orphaned: 'A stop label no longer matches a detected stop.',
  poor_accuracy_share: 'Over 30% of positions were imprecise.',
  low_fix_density: 'Few positions were recorded for the length of the shift.',
  clock_skew: "The phone's clock was more than 2 minutes off.",
  override_orphaned: 'A trip edit no longer matches a trip.',
  manual_trip_present: 'A trip you added by hand is in the totals.',
  calc_mismatch: "The server's figures differ from the phone's.",
};
export const flagWords = (code: string) => FLAG_WORDS[code] ?? code;

/** The phone check (recon_status): did the phone's own result match the server's? */
const RECON_WORDS: Record<NonNullable<Shift['recon_status']>, string> = {
  pending: "Waiting for the phone's result.",
  match: 'The phone and the server agree.',
  differs: 'The phone and the server worked out different totals.',
  phone_missing: "The phone's result never arrived.",
};

/** The name of the shift's vehicle, or null while unknown. */
export function useVehicleName(id: number): string | null {
  const { api } = useSession();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void unwrap<Schemas['Vehicle'][]>(
      api.GET('/vehicles', { params: { query: { include_archived: true } } }),
    )
      .then((list) => live && setName(list.find((v) => v.id === id)?.name ?? null))
      .catch(() => {}); // the name is a nicety; the page works without it
    return () => {
      live = false;
    };
  }, [api, id]);
  return name;
}

/**
 * The shift's key figures. Total distance is never marked estimated; the active and deadhead
 * split is, and only when the shift was segmented by stops (05 section 3.1a).
 */
export function ShiftFigures({
  shift,
  settings,
  split,
  est,
}: {
  shift: Shift;
  settings: Settings;
  split: boolean;
  est: React.ReactNode;
}) {
  const unit = settings.distance_unit;
  const business =
    shift.active_m === null || shift.deadhead_m === null ? null : shift.active_m + shift.deadhead_m;
  return (
    <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-5">
      <StatCard
        label="Distance"
        value={formatDistance(shift.total_m, unit)}
        sub={shift.personal_m ? `${formatDistance(shift.personal_m, unit)} personal` : undefined}
      />
      <StatCard
        label="Business"
        value={formatDistance(business, unit)}
        sub={
          split ? (
            <>
              <div>
                {formatDistance(shift.active_m, unit)} active{est}
              </div>
              <div>
                {formatDistance(shift.deadhead_m, unit)} deadhead{est}
              </div>
            </>
          ) : undefined
        }
      />
      <StatCard label="Time" value={formatDuration(shift.started_at, shift.ended_at)} />
      <StatCard
        label={deductionWord(settings, true)}
        value={formatMoney(shift.deduction_cents, settings.currency)}
      />
    </div>
  );
}

/** Flags and the phone check in plain words; "review" ones first. */
export function ShiftChecks({ shift }: { shift: Shift }) {
  const flags = [...(shift.flags ?? [])].sort(
    (a, b) => Number(b.severity === 'review') - Number(a.severity === 'review'),
  );
  return (
    <Section label="Checks" title="Checks">
      {flags.length === 0 && !shift.recon_status ? (
        <p className="text-sm text-muted-foreground">Nothing to check.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {flags.map((f, i) => (
            <li key={`${f.code}-${i}`} className="flex items-start justify-between gap-3">
              <span className={f.severity === 'review' ? '' : 'text-muted-foreground'}>
                {flagWords(f.code)}
              </span>
              {f.severity === 'review' ? (
                <Badge variant="outline" className="shrink-0 border-primary/60">
                  Review
                </Badge>
              ) : null}
            </li>
          ))}
          {shift.recon_status ? (
            <li className="text-muted-foreground">{RECON_WORDS[shift.recon_status]}</li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}
