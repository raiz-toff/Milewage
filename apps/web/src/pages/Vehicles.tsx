import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';

type Vehicle = Schemas['Vehicle'];
type Kind = Vehicle['kind'];

const KINDS: { value: Kind; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'bicycle', label: 'Bicycle' },
];
const kindLabel = (k: Kind) => KINDS.find((x) => x.value === k)?.label ?? k;

function VehicleRow({ vehicle, onChanged }: { vehicle: Vehicle; onChanged: () => void }) {
  const { api } = useSession();
  const { timezone } = useSettings();
  const [edit, setEdit] = useState<{ name: string; kind: Kind } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archived = vehicle.archived_at !== null;

  async function act(body: { name?: string; kind?: Kind; archived?: boolean }) {
    setError(null);
    try {
      await unwrap(api.PATCH('/vehicles/{id}', { params: { path: { id: vehicle.id } }, body }));
      setEdit(null);
      onChanged();
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-4">
        {edit === null ? (
          <span className={archived ? 'text-muted line-through' : ''}>{vehicle.name}</span>
        ) : (
          <input
            aria-label={`New name for ${vehicle.name}`}
            className="rounded border border-line bg-bg px-2 py-1"
            maxLength={64}
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
        )}
        <FormError message={error} />
      </td>
      <td className="pr-4 text-muted">
        {edit === null ? (
          kindLabel(vehicle.kind)
        ) : (
          <select
            aria-label={`Type of ${vehicle.name}`}
            className="rounded border border-line bg-bg px-2 py-1 text-ink"
            value={edit.kind}
            onChange={(e) => setEdit({ ...edit, kind: e.target.value as Kind })}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="pr-4 font-mono text-sm text-muted">
        {formatDateTime(vehicle.created_at, timezone)}
      </td>
      <td className="pr-4 text-muted">{archived ? 'archived' : 'active'}</td>
      <td className="space-x-3 text-right">
        {edit !== null ? (
          <>
            <button
              type="button"
              className="text-accent"
              disabled={!edit.name.trim()}
              onClick={() => void act({ name: edit.name.trim(), kind: edit.kind })}
            >
              Save
            </button>
            <button type="button" className="text-muted" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {archived ? null : (
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setEdit({ name: vehicle.name, kind: vehicle.kind })}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="text-muted hover:text-ink"
              onClick={() => void act({ archived: !archived })}
            >
              {archived ? 'Restore' : 'Archive'}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * Vehicles (07 section 2.2): the driver's vehicles. Vehicles are archived, never deleted, because
 * a shift in the tax record points at one. An archived vehicle stays in history and drops out of
 * the pickers.
 */
export function VehiclesPage() {
  const { api } = useSession();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('car');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setVehicles(
        await unwrap<Vehicle[]>(
          api.GET('/vehicles', { params: { query: { include_archived: showArchived } } }),
        ),
      );
    } catch (e) {
      setError(describe(e));
    }
  }, [api, showArchived]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST('/vehicles', { body: { name: name.trim(), kind } }));
      setName('');
      await load();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Vehicles</h1>
      <form className="grid max-w-xl gap-3 sm:grid-cols-3" onSubmit={(e) => void add(e)}>
        <Field label="Name" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField
          label="Type"
          value={kind}
          onChange={(v) => setKind(v as Kind)}
          options={KINDS}
        />
        <div className="flex items-end">
          <Button type="submit" busy={busy || name.trim() === ''}>
            Add vehicle
          </Button>
        </div>
      </form>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--mw-accent)]"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived vehicles
      </label>
      <FormError message={error} />
      {vehicles === null ? (
        <p className="text-muted">Loading</p>
      ) : vehicles.length === 0 ? (
        <p className="text-muted">No vehicles yet. Add the one you drive for work.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Vehicles</caption>
          <thead className="text-sm text-muted">
            <tr>
              <th className="pb-2 font-normal">Name</th>
              <th className="font-normal">Type</th>
              <th className="font-normal">Added</th>
              <th className="font-normal">State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <VehicleRow key={v.id} vehicle={v} onChanged={() => void load()} />
            ))}
          </tbody>
        </table>
      )}
      <p className="max-w-xl text-sm text-muted">
        The type decides which mileage rate applies. Vehicles are archived rather than deleted so
        past shifts keep their vehicle.
      </p>
    </section>
  );
}
