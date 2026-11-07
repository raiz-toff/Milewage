import { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, Picker, SelectField } from '../ui/form';
import { RowMenu } from '../ui/RowMenu';
import { Archive, ArchiveRestore, Pencil, Star } from 'lucide-react';
import { VehicleMaintenance } from './VehicleMaintenance';
import { VehicleTaxYear } from './VehicleTaxYear';

type Vehicle = Schemas['Vehicle'];
type Kind = Vehicle['kind'];

const KINDS: { value: Kind; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'ebike', label: 'E-bike' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'walking', label: 'On foot' },
];
const kindLabel = (k: Kind) => KINDS.find((x) => x.value === k)?.label ?? k;

function VehicleRow({ vehicle, onChanged }: { vehicle: Vehicle; onChanged: () => void }) {
  const { api } = useSession();
  const { timezone } = useSettings();
  const [edit, setEdit] = useState<{
    name: string;
    kind: Kind;
    make: string;
    model: string;
    year: string;
    plate: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState(false);
  const archived = vehicle.archived_at !== null;

  const { setSettings } = useSession();
  const saved = useSettings();
  async function makeDefault() {
    setError(null);
    try {
      setSettings(
        await unwrap(api.PATCH('/settings', { body: { default_vehicle_id: vehicle.id } })),
      );
    } catch (e) {
      setError(describe(e));
    }
  }
  async function act(body: Schemas['VehicleCreate'] | { archived: boolean }) {
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
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-4">
        {edit === null ? (
          <span className={archived ? 'text-muted-foreground line-through' : ''}>
            {vehicle.name}
          </span>
        ) : (
          <input
            aria-label={`New name for ${vehicle.name}`}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            maxLength={64}
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
        )}
        {edit !== null ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['make', 'model', 'year', 'plate'] as const).map((k) => (
              <input
                key={k}
                aria-label={`${k[0]!.toUpperCase()}${k.slice(1)} of ${vehicle.name}`}
                placeholder={k}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                value={edit[k]}
                onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
              />
            ))}
          </div>
        ) : (
          <span className="block text-sm text-muted-foreground">
            {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
            {saved.default_vehicle_id === vehicle.id ? ' (default)' : ''}
          </span>
        )}
        {saved.modules.tax && !archived && edit === null ? (
          <VehicleTaxYear vehicleId={vehicle.id} name={vehicle.name} />
        ) : null}
        {saved.modules.maintenance && !archived && edit === null ? (
          <>
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              aria-expanded={service}
              onClick={() => setService(!service)}
            >
              {service ? 'Hide service log' : 'Service log'}
            </UiButton>
            {service ? <VehicleMaintenance vehicleId={vehicle.id} name={vehicle.name} /> : null}
          </>
        ) : null}
        <FormError message={error} />
      </td>
      <td className="pr-4 text-muted-foreground">
        {edit === null ? (
          kindLabel(vehicle.kind)
        ) : (
          <Picker
            label={`Type of ${vehicle.name}`}
            size="sm"
            className="w-auto min-w-28"
            value={edit.kind}
            onChange={(v) => setEdit({ ...edit, kind: v as Kind })}
            options={KINDS}
          />
        )}
      </td>
      <td className="pr-4 tabular-nums text-sm text-muted-foreground">
        {formatDateTime(vehicle.created_at, timezone)}
      </td>
      <td>
        <Badge variant={archived ? 'outline' : 'secondary'}>
          {archived ? 'archived' : 'active'}
        </Badge>
      </td>
      <td className="space-x-3 text-right whitespace-nowrap">
        {edit !== null ? (
          <>
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              disabled={!edit.name.trim()}
              onClick={() =>
                void act({
                  name: edit.name.trim(),
                  kind: edit.kind,
                  make: edit.make.trim() || null,
                  model: edit.model.trim() || null,
                  year: edit.year.trim() === '' ? null : Number(edit.year),
                  plate: edit.plate.trim() || null,
                })
              }
            >
              Save
            </UiButton>
            <UiButton type="button" variant="ghost" size="sm" onClick={() => setEdit(null)}>
              Cancel
            </UiButton>
          </>
        ) : (
          <RowMenu
            name={vehicle.name}
            actions={[
              ...(archived
                ? []
                : [
                    {
                      label: 'Edit',
                      icon: Pencil,
                      onSelect: () =>
                        setEdit({
                          name: vehicle.name,
                          kind: vehicle.kind,
                          make: vehicle.make ?? '',
                          model: vehicle.model ?? '',
                          year: vehicle.year === null ? '' : String(vehicle.year),
                          plate: vehicle.plate ?? '',
                        }),
                    },
                  ]),
              ...(archived || saved.default_vehicle_id === vehicle.id
                ? []
                : [{ label: 'Make default', icon: Star, onSelect: () => void makeDefault() }]),
              archived
                ? {
                    label: 'Restore',
                    icon: ArchiveRestore,
                    onSelect: () => void act({ archived: false }),
                  }
                : {
                    label: 'Archive',
                    icon: Archive,
                    destructive: true,
                    onSelect: () => void act({ archived: true }),
                  },
            ]}
          />
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
      <PageHeader
        title="Vehicles"
        description="The type decides which mileage rate applies. Vehicles are archived rather than deleted so past shifts keep their vehicle."
      />
      <Section title="Add a vehicle">
        <form className="grid gap-3 sm:grid-cols-[1fr_200px_auto]" onSubmit={(e) => void add(e)}>
          <Field
            label="Name"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
      </Section>
      <Section
        title="Your vehicles"
        action={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived vehicles
          </label>
        }
      >
        <FormError message={error} />
        {vehicles === null ? (
          <p className="text-sm text-muted-foreground">Loading</p>
        ) : vehicles.length === 0 ? (
          <EmptyState>No vehicles yet. Add the one you drive for work.</EmptyState>
        ) : (
          <TableBox>
            <table className={tableClass}>
              <caption className="sr-only">Vehicles</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Added</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <VehicleRow key={v.id} vehicle={v} onChanged={() => void load()} />
                ))}
              </tbody>
            </table>
          </TableBox>
        )}
      </Section>
    </section>
  );
}
