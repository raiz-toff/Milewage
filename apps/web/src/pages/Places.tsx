import { lazy, Suspense, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { DeleteIcon, EditIcon } from '@/ui/icons';
import type { Schemas } from '../api/client';
import { errorText, useApiQuery, useChange } from '../api/query';
import { HelpLink } from '../help';
import { centreText, parseCentre, RADIUS, ROLES, type PlaceDraft } from '../places';
import { useShiftRoute } from '../map/RouteView';
import type { MapCircle } from '../map/PlacesMap';
import { SegmentedButtons } from '../ui/chips';
import { Button, Field, FormError } from '../ui/form';
import { EmptyState, PageHeader, Section } from '../ui/layout';
import { RowMenu } from '../ui/RowMenu';

const PlacesMap = lazy(() => import('../map/PlacesMap'));

type Place = Schemas['Place'];
type Role = Place['role'];
type Result = Schemas['PlaceChangeResult'];

const roleWord = (r: Role) => ROLES.find((x) => x.value === r)!.label;

interface Form {
  name: string;
  role: Role;
  radius: string;
  centre: string;
}
const blank = (d?: PlaceDraft | null): Form => ({
  name: d?.name ?? '',
  role: d?.role ?? 'pickup',
  radius: String(RADIUS.default),
  centre: d ? centreText(d.lat_e7, d.lon_e7) : '',
});

/** "Worked out again" in words, after a save or a delete. */
function outcome(r: Result, done: string): string {
  const n = r.shifts_recalculated;
  const k = r.shifts_kept;
  return [
    done,
    n === 0
      ? ''
      : n === 1
        ? 'One shift was worked out again.'
        : `${n} shifts were worked out again.`,
    k === 0
      ? ''
      : k === 1
        ? 'One finalized or archived shift keeps its figures.'
        : `${k} finalized or archived shifts keep their figures.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Places (ADR 0008): the places a driver stops at often, each with a name, a centre, a radius and
 * the label it gives the stops inside it. Shown while stop detection is on. Centres come from a
 * stop ("Save as a place" on a shift's page), a click on the map, or typed coordinates; nothing is
 * looked up anywhere.
 */
export function PlacesPage() {
  const handed = (useLocation().state as { draft?: PlaceDraft } | null)?.draft ?? null;
  const query = useApiQuery('/places');
  const places = query.data ?? null;
  const change = useChange();
  const [editing, setEditing] = useState<Place | null>(null);
  const [form, setForm] = useState<Form>(() => blank(handed));
  const [said, setSaid] = useState<string | null>(null);
  const error = errorText(change, query);

  // Where to look when there is nothing yet: the route of the latest ended shift.
  const latest = useApiQuery(
    '/shifts',
    { params: { query: { status: 'ended', limit: 1 } } },
    { enabled: places !== null && places.length === 0 && !handed },
  ).data?.items[0];
  const route = useShiftRoute(latest?.id ?? 0, !!latest);
  const fallback = useMemo(
    () => (route.points ?? []).map((p): [number, number] => [p.lon, p.lat]),
    [route.points],
  );

  const centre = parseCentre(form.centre);
  const radius = Number(form.radius);
  const draft: MapCircle | null = centre
    ? {
        id: editing?.id ?? 'draft',
        name: form.name,
        lat: centre.lat_e7 / 1e7,
        lon: centre.lon_e7 / 1e7,
        radiusM:
          Number.isInteger(radius) && radius >= RADIUS.min && radius <= RADIUS.max
            ? radius
            : RADIUS.default,
      }
    : null;
  const circles = useMemo(
    () =>
      (places ?? []).map((p): MapCircle => ({
        id: p.id,
        name: p.name,
        lat: p.lat_e7 / 1e7,
        lon: p.lon_e7 / 1e7,
        radiusM: p.radius_m,
      })),
    [places],
  );

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  function edit(p: Place) {
    change.setError(null);
    setSaid(null);
    setEditing(p);
    setForm({
      name: p.name,
      role: p.role,
      radius: String(p.radius_m),
      centre: centreText(p.lat_e7, p.lon_e7),
    });
  }
  function reset() {
    change.setError(null);
    setEditing(null);
    setForm(blank());
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaid(null);
    const name = form.name.trim();
    if (!name) return change.setError('Enter a name for the place.');
    if (!centre)
      return change.setError(
        'Choose the centre: click the map, or type a latitude and a longitude, for example 43.65107, -79.34702.',
      );
    if (!Number.isInteger(radius) || radius < RADIUS.min || radius > RADIUS.max) {
      return change.setError(
        `Enter a radius from ${RADIUS.min} to ${RADIUS.max} metres, in whole metres.`,
      );
    }
    const body = { name, role: form.role, radius_m: radius, ...centre };
    const done = editing
      ? await change.run((api) =>
          api.PATCH('/places/{id}', { params: { path: { id: editing.id } }, body }),
        )
      : await change.run((api) => api.POST('/places', { body }));
    if (done) {
      setSaid(outcome(done.data, editing ? `Saved ${name}.` : `Added ${name}.`));
      reset();
    }
  }

  async function remove(p: Place) {
    setSaid(null);
    const done = await change.run((api) =>
      api.DELETE('/places/{id}', { params: { path: { id: p.id } } }),
    );
    if (done) {
      if (editing?.id === p.id) reset();
      setSaid(outcome(done.data, `Deleted ${p.name}.`));
    }
  }

  return (
    <section className="@container space-y-6">
      <PageHeader
        title="Places"
        description={
          <>
            Places you stop at often. A stop inside a place shows its name and gets its label,
            unless you labelled the stop yourself.{' '}
            <HelpLink page="places">How places label stops</HelpLink>
          </>
        }
      />
      {said ? (
        <p role="status" className="text-body-medium text-on-surface">
          {said}
        </p>
      ) : null}
      <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section
          label="Map of your places"
          title="Map"
          description="Click the map to put the centre of the place, or drag the marker."
          className="min-w-0"
        >
          <Suspense fallback={<p className="text-muted-foreground">Loading the map</p>}>
            <PlacesMap
              places={circles}
              draft={draft}
              fallback={fallback}
              onPick={(lat, lon) =>
                set({ centre: centreText(Math.round(lat * 1e7), Math.round(lon * 1e7)) })
              }
            />
          </Suspense>
        </Section>
        <Section title={editing ? `Edit ${editing.name}` : 'Add a place'} className="min-w-0">
          <form
            aria-label={editing ? 'Edit place' : 'Add a place'}
            className="space-y-3"
            onSubmit={(e) => void save(e)}
          >
            <Field
              label="Name"
              maxLength={120}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <div className="space-y-1">
              <p className="text-body-small text-on-surface-variant">Label for stops here</p>
              <SegmentedButtons
                label="Label for stops here"
                value={form.role}
                onChange={(role) => set({ role })}
                options={ROLES}
              />
            </div>
            <Field
              label="Radius (m)"
              inputMode="numeric"
              hint={`${RADIUS.min} to ${RADIUS.max} m. A stop this close to the centre is in the place.`}
              value={form.radius}
              onChange={(e) => set({ radius: e.target.value })}
            />
            <Field
              label="Centre (latitude, longitude)"
              inputMode="decimal"
              hint="Filled in when you click the map."
              value={form.centre}
              onChange={(e) => set({ centre: e.target.value })}
            />
            <FormError message={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={change.busy}>
                {editing ? 'Save changes' : 'Save place'}
              </Button>
              {editing || form.name || form.centre ? (
                <Button type="button" variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </Section>
      </div>
      <Section label="Your places" title="Your places">
        {places === null ? null : places.length === 0 ? (
          <EmptyState>
            No places yet. Save one from a stop on a shift&apos;s page, or click the map above.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {places.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body-large text-on-surface">{p.name}</p>
                  <p className="text-body-small text-on-surface-variant tabular-nums">
                    {roleWord(p.role)} · {p.radius_m} m
                  </p>
                </div>
                <RowMenu
                  name={p.name}
                  actions={[
                    { label: 'Edit', icon: EditIcon, onSelect: () => edit(p) },
                    {
                      label: 'Delete',
                      icon: DeleteIcon,
                      destructive: true,
                      onSelect: () => void remove(p),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </section>
  );
}
