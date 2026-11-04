import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { describe, unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { formatDateTime, formatDistance, formatDuration, formatMoney } from '../format';
import { RouteView } from '../map/RouteView';
import { useSession, useSettings } from '../session';
import { SortTable } from '../ui/SortTable';
import type { Column } from '../ui/SortTable';
import { Button, FormError } from '../ui/form';

type Shift = Schemas['Shift'];

/** The split is shown only while stops are on and only for a shift that was segmented by stops. */
export const showsSplit = (s: Shift, settings: Settings) =>
  settings.modules.stops && s.segmenter === 'stops';

/** An estimate always carries its marker (05 section 3.1a). Totals never do. */
export function Est() {
  return (
    <abbr title="Estimated from detected stops" className="ml-0.5 cursor-help no-underline">
      *
    </abbr>
  );
}

function columns(settings: Settings): Column<Shift>[] {
  const unit = settings.distance_unit;
  const split = settings.modules.stops;
  const dist = (pick: (s: Shift) => number | null, estimated: boolean) => (s: Shift) =>
    estimated && !showsSplit(s, settings) ? '—' : formatDistance(pick(s), unit);
  const cols: Column<Shift>[] = [
    {
      key: 'date',
      label: 'Date',
      sortValue: (s) => s.started_at,
      render: (s) => (
        <Link className="text-accent hover:underline" to={`/shifts/${s.id}`}>
          {s.local_date}
        </Link>
      ),
    },
    {
      key: 'duration',
      label: 'Duration',
      sortValue: (s) => (s.ended_at === null ? null : s.ended_at - s.started_at),
      render: (s) => formatDuration(s.started_at, s.ended_at),
    },
    {
      key: 'total',
      label: 'Total',
      numeric: true,
      sortValue: (s) => s.total_m,
      render: dist((s) => s.total_m, false),
    },
  ];
  if (split) {
    cols.push(
      {
        key: 'active',
        label: 'Active*',
        numeric: true,
        sortValue: (s) => (showsSplit(s, settings) ? s.active_m : null),
        render: dist((s) => s.active_m, true),
      },
      {
        key: 'deadhead',
        label: 'Deadhead*',
        numeric: true,
        sortValue: (s) => (showsSplit(s, settings) ? s.deadhead_m : null),
        render: dist((s) => s.deadhead_m, true),
      },
    );
  }
  cols.push(
    {
      key: 'flags',
      label: 'Flags',
      numeric: true,
      sortValue: (s) => s.flags?.length ?? 0,
      render: (s) => String(s.flags?.length ?? 0),
    },
    { key: 'status', label: 'Status', sortValue: (s) => s.status, render: (s) => s.status },
  );
  return cols;
}

export function ShiftList() {
  const { api } = useSession();
  const settings = useSettings();
  const [rows, setRows] = useState<Shift[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setError(null);
      try {
        const query = {
          limit: 50,
          ...(cursor ? { cursor } : {}),
          ...(status ? { status: status as Shift['status'] } : {}),
        };
        const page = await unwrap(api.GET('/shifts', { params: { query } }));
        setRows((old) => (cursor && old ? [...old, ...page.items] : page.items));
        setNext(page.next_cursor ?? null);
      } catch (e) {
        setError(describe(e));
      }
    },
    [api, status],
  );
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl">Shifts</h1>
        <label className="text-sm text-muted">
          Status{' '}
          <select
            className="rounded border border-line bg-bg px-2 py-1 text-ink"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
            <option value="finalized">Finalized</option>
          </select>
        </label>
      </div>
      <FormError message={error} />
      {rows === null ? (
        <p className="text-muted">Loading</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">No shifts yet. Start one on the phone.</p>
      ) : (
        <>
          <SortTable
            caption="Shifts"
            columns={columns(settings)}
            rows={rows}
            rowKey={(s) => s.id}
            initialSort={{ key: 'date', dir: 'desc' }}
          />
          {settings.modules.stops ? (
            <p className="text-sm text-muted">* estimated from detected stops</p>
          ) : null}
          {next ? (
            <Button type="button" onClick={() => void load(next)}>
              Load more
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 border-t border-line py-2 first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono">{children}</dd>
    </div>
  );
}

export function ShiftDetail() {
  const { ref } = useParams();
  const { api } = useSession();
  const settings = useSettings();
  const [shift, setShift] = useState<Shift | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void unwrap(api.GET('/shifts/{ref}', { params: { path: { ref: ref ?? '' } } }))
      .then((s) => {
        if (!live) return;
        setShift(s);
        setNotes(s.notes ?? '');
      })
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, ref]);

  async function saveNotes() {
    if (!shift) return;
    setError(null);
    try {
      const s = await unwrap(
        api.PATCH('/shifts/{ref}', {
          params: { path: { ref: String(shift.id) } },
          body: { notes: notes.trim() === '' ? null : notes },
        }),
      );
      setShift(s);
      setSaved(true);
    } catch (e) {
      setError(describe(e));
    }
  }

  if (error && !shift)
    return (
      <p role="alert" className="text-muted">
        {error}
      </p>
    );
  if (!shift) return <p className="text-muted">Loading</p>;
  const split = showsSplit(shift, settings);
  const tz = settings.timezone;

  return (
    <section className="space-y-6">
      <Link to="/shifts" className="text-sm text-muted hover:text-ink">
        All shifts
      </Link>
      <h1 className="font-heading text-2xl">Shift on {shift.local_date}</h1>
      <dl className="max-w-md">
        <Row label="Started">{formatDateTime(shift.started_at, tz)}</Row>
        <Row label="Ended">
          {shift.ended_at ? formatDateTime(shift.ended_at, tz) : 'in progress'}
        </Row>
        <Row label="Duration">{formatDuration(shift.started_at, shift.ended_at)}</Row>
        <Row label="Total">{formatDistance(shift.total_m, settings.distance_unit)}</Row>
        {split ? (
          <>
            <Row label="Active">
              {formatDistance(shift.active_m, settings.distance_unit)}
              <Est />
            </Row>
            <Row label="Deadhead">
              {formatDistance(shift.deadhead_m, settings.distance_unit)}
              <Est />
            </Row>
          </>
        ) : null}
        <Row label="Personal">{formatDistance(shift.personal_m, settings.distance_unit)}</Row>
        <Row label="Deduction">{formatMoney(shift.deduction_cents, settings.currency)}</Row>
        <Row label="Status">{shift.status}</Row>
        {shift.recon_status ? <Row label="Phone check">{shift.recon_status}</Row> : null}
      </dl>
      {split ? <p className="text-sm text-muted">* estimated from detected stops</p> : null}

      <section aria-label="Flags" className="space-y-2">
        <h2 className="font-heading text-lg">Flags</h2>
        {shift.flags?.length ? (
          <ul className="space-y-1">
            {shift.flags.map((f, i) => (
              <li
                key={`${f.code}-${i}`}
                className={f.severity === 'review' ? 'text-ink' : 'text-muted'}
              >
                {f.code}
                <span className="ml-2 text-xs uppercase text-muted">{f.severity}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None.</p>
        )}
      </section>

      {settings.modules.replay ? <RouteView shiftId={shift.id} /> : null}

      <section className="max-w-md space-y-2">
        <label className="block text-sm text-muted" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          className="w-full rounded border border-line bg-bg p-2 text-ink"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => {
            setSaved(false);
            setNotes(e.target.value);
          }}
        />
        <FormError message={error} />
        <Button type="button" busy={notes === (shift.notes ?? '')} onClick={() => void saveNotes()}>
          Save notes
        </Button>
        {saved ? (
          <span role="status" className="ml-3 text-sm text-accent">
            Saved.
          </span>
        ) : null}
      </section>
    </section>
  );
}

export function ShiftsRoutes() {
  return (
    <Routes>
      <Route index element={<ShiftList />} />
      <Route path=":ref" element={<ShiftDetail />} />
    </Routes>
  );
}
