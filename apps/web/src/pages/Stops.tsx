import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatTime, minorDigits, moneyInput, parseMoney } from '../format';
import { useSession, useSettings } from '../session';
import { SortTable } from '../ui/SortTable';
import type { Column } from '../ui/SortTable';
import { Button, FormError, Picker } from '../ui/form';

type Stop = Schemas['Stop'];
type Shift = Schemas['Shift'];

/** What the row's controls hold before they are saved. Money is typed in whole currency units. */
interface Draft {
  role: '' | 'pickup' | 'dropoff' | 'other';
  platform: string;
  place: string;
  payout: string;
  tip: string;
}

const money = (minor: number, currency: string) => (minor === 0 ? '' : moneyInput(minor, currency));

export const draftOf = (s: Stop, currency: string): Draft => ({
  role: s.label?.role ?? '',
  platform: s.label?.platform ?? '',
  place: s.label?.place ?? '',
  payout: money(s.label?.payout_cents ?? 0, currency),
  tip: money(s.label?.tip_cents ?? 0, currency),
});

/** Typed money to whole minor units; blank is zero, anything else that is not an amount is null. */
export function toMinor(text: string, currency: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  const places = minorDigits(currency);
  const shape = places === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${places}})?$`);
  if (!shape.test(t)) return null;
  return parseMoney(t, currency);
}

/**
 * Shown above the table. A pickup that follows a pickup with no drop-off between them is the
 * stacked-orders case the estimate under-states (05 section 3.1a, 14 section 6.4).
 */
export function hasStackedOrders(stops: Stop[]): boolean {
  let open = false;
  for (const s of stops) {
    if (s.role === 'pickup') {
      if (open) return true;
      open = true;
    } else if (s.role === 'dropoff') open = false;
  }
  return false;
}

const roleText = (r: Stop['est_role']) => (r === 'none' ? '—' : r);
const dwell = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;

const ROLES = [
  { value: '', label: 'Not labelled' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'dropoff', label: 'Dropoff' },
  { value: 'other', label: 'Other' },
];

const FIELD =
  'w-full min-w-24 h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

/** The detected stops of a shift, read once per shift; label saves update the list in place. */
export function useShiftStops(shiftId: number, on: boolean) {
  const { api } = useSession();
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void unwrap(api.GET('/shifts/{ref}/stops', { params: { path: { ref: String(shiftId) } } }))
      .then((list) => live && setStops(list))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, shiftId, on]);
  return { stops, setStops, error };
}

/**
 * Detected stops of a shift with optional labels (module `stops`, web only). A save or a clear
 * recomputes the shift on the server; the new shift goes to `onShift` so the split above
 * and the trips below show the new estimate.
 */
export function StopsPanel({
  shift,
  onShift,
  data: { stops, setStops, error },
}: {
  shift: Shift;
  onShift: (shift: Shift) => void;
  data: ReturnType<typeof useShiftStops>;
}) {
  const { api } = useSession();
  const { currency, timezone } = useSettings();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function apply(key: string, stop: Stop | null, next: Shift) {
    setStops((old) => (old ?? []).flatMap((s) => (s.stop_key !== key ? [s] : stop ? [stop] : [])));
    if (stop) setDrafts((d) => ({ ...d, [key]: draftOf(stop, currency) }));
    onShift(next);
  }

  async function save(s: Stop) {
    const d = drafts[s.stop_key];
    if (!d || d.role === '') return;
    const payout = toMinor(d.payout, currency);
    const tip = toMinor(d.tip, currency);
    if (payout === null || tip === null) {
      setRowError((e) => ({ ...e, [s.stop_key]: 'Enter an amount such as 12.50.' }));
      return;
    }
    setBusy(s.stop_key);
    setRowError((e) => ({ ...e, [s.stop_key]: '' }));
    try {
      const r = await unwrap(
        api.PUT('/shifts/{ref}/stop-labels/{stop_key}', {
          params: { path: { ref: String(shift.id), stop_key: s.stop_key } },
          body: {
            role: d.role,
            platform: d.platform.trim() === '' ? null : d.platform.trim(),
            place: d.place.trim() === '' ? null : d.place.trim(),
            payout_cents: payout,
            tip_cents: tip,
            notes: s.label?.notes ?? null,
            edited_at: Date.now(),
          },
        }),
      );
      apply(s.stop_key, r.stop, r.shift);
    } catch (e) {
      setRowError((x) => ({ ...x, [s.stop_key]: describe(e) }));
    } finally {
      setBusy(null);
    }
  }

  async function clear(s: Stop) {
    setBusy(s.stop_key);
    setRowError((e) => ({ ...e, [s.stop_key]: '' }));
    try {
      const r = await unwrap(
        api.DELETE('/shifts/{ref}/stop-labels/{stop_key}', {
          params: { path: { ref: String(shift.id), stop_key: s.stop_key } },
        }),
      );
      apply(s.stop_key, r.stop, r.shift);
    } catch (e) {
      setRowError((x) => ({ ...x, [s.stop_key]: describe(e) }));
    } finally {
      setBusy(null);
    }
  }

  const columns = ((): Column<Stop>[] => {
    const set = (s: Stop, patch: Partial<Draft>) =>
      setDrafts((d) => ({
        ...d,
        [s.stop_key]: { ...(d[s.stop_key] ?? draftOf(s, currency)), ...patch },
      }));
    const dirty = (s: Stop) => {
      const a = drafts[s.stop_key] ?? draftOf(s, currency);
      const b = draftOf(s, currency);
      return (Object.keys(a) as (keyof Draft)[]).some((k) => a[k] !== b[k]);
    };
    const input = (s: Stop, key: 'platform' | 'place' | 'payout' | 'tip', label: string) => (
      <input
        aria-label={`${label} at ${formatTime(s.started_at, timezone)}`}
        className={FIELD}
        inputMode={key === 'payout' || key === 'tip' ? 'decimal' : undefined}
        value={(drafts[s.stop_key] ?? draftOf(s, currency))[key]}
        onChange={(e) => set(s, { [key]: e.target.value })}
      />
    );
    return [
      {
        key: 'time',
        label: 'Time',
        sortValue: (s) => s.started_at,
        render: (s) => formatTime(s.started_at, timezone),
        text: (s) => formatTime(s.started_at, timezone),
      },
      {
        key: 'dwell',
        label: 'Dwell',
        numeric: true,
        sortValue: (s) => s.dwell_s,
        text: (s) => dwell(s.dwell_s),
        render: (s) => dwell(s.dwell_s),
      },
      {
        key: 'confidence',
        label: 'Confidence',
        sortValue: (s) => s.confidence,
        render: (s) => s.confidence,
      },
      {
        key: 'estimate',
        label: 'Estimate*',
        sortValue: (s) => s.est_role,
        text: (s) => roleText(s.est_role),
        render: (s) => roleText(s.est_role),
      },
      {
        key: 'label',
        label: 'Label',
        sortValue: (s) => s.label?.role ?? null,
        text: (s) => s.label?.role ?? '',
        render: (s) => (
          <Picker
            label={`Label at ${formatTime(s.started_at, timezone)}`}
            size="sm"
            className="min-w-32"
            value={(drafts[s.stop_key] ?? draftOf(s, currency)).role}
            onChange={(v) => set(s, { role: v as Draft['role'] })}
            options={ROLES}
          />
        ),
      },
      {
        key: 'platform',
        label: 'Platform',
        sortValue: (s) => s.label?.platform ?? null,
        text: (s) => s.label?.platform ?? '',
        render: (s) => input(s, 'platform', 'Platform'),
      },
      {
        key: 'place',
        label: 'Place',
        sortValue: (s) => s.label?.place ?? null,
        text: (s) => s.label?.place ?? '',
        render: (s) => input(s, 'place', 'Place'),
      },
      {
        key: 'payout',
        label: `Payout (${currency})`,
        numeric: true,
        sortValue: (s) => s.label?.payout_cents ?? null,
        text: (s) => money(s.label?.payout_cents ?? 0, currency),
        render: (s) => input(s, 'payout', 'Payout'),
      },
      {
        key: 'tip',
        label: `Tip (${currency})`,
        numeric: true,
        sortValue: (s) => s.label?.tip_cents ?? null,
        text: (s) => money(s.label?.tip_cents ?? 0, currency),
        render: (s) => input(s, 'tip', 'Tip'),
      },
      {
        key: 'actions',
        label: 'Actions',
        sortValue: () => null,
        text: () => '',
        render: (s) => (
          <div className="space-y-1">
            <div className="flex gap-2">
              <Button
                type="button"
                busy={busy === s.stop_key || !dirty(s) || (drafts[s.stop_key]?.role ?? '') === ''}
                onClick={() => void save(s)}
              >
                Save
              </Button>
              {s.label ? (
                <Button type="button" busy={busy === s.stop_key} onClick={() => void clear(s)}>
                  Clear
                </Button>
              ) : null}
            </div>
            <FormError message={rowError[s.stop_key] || null} />
          </div>
        ),
      },
    ];
  })();

  if (error) return <p className="text-muted-foreground">Stops could not be loaded. {error}</p>;
  if (stops === null) return <p className="text-muted-foreground">Loading stops</p>;

  const orphans = (shift.flags ?? []).filter((f) => f.code === 'label_orphaned');
  const edited = (shift.flags ?? []).some((f) => f.code === 'manual_trip_present');
  return (
    <div className="space-y-3">
      {hasStackedOrders(stops) ? (
        <p role="status" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          Stacked orders? The estimate under-states active distance when orders overlap. Label the
          stops to correct it.
        </p>
      ) : null}
      {edited ? (
        <p role="status" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          This shift has edited trips. Labelling a stop may unlink those edits.
        </p>
      ) : null}
      {orphans.length ? (
        <p role="status" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          Label not applied: {orphans.length === 1 ? 'a label' : `${orphans.length} labels`} no
          longer match a detected stop and{orphans.length === 1 ? ' is' : ' are'} kept but unused.
        </p>
      ) : null}
      {stops.length === 0 ? (
        <p className="text-muted-foreground">No stops were detected.</p>
      ) : (
        <>
          <SortTable
            caption="Detected stops"
            columns={columns}
            rows={stops}
            rowKey={(s) => s.stop_key}
            initialSort={{ key: 'time', dir: 'asc' }}
          />
          <p className="text-sm text-muted-foreground">
            * The engine&apos;s estimate. A label replaces it for that stop, and labelling is
            optional. Earnings count labels only.
          </p>
        </>
      )}
    </div>
  );
}
