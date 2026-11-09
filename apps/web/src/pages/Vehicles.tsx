import { useId, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { EmptyState, PageHeader, Section } from '../ui/layout';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { FormEvent } from 'react';
import type { Schemas } from '../api/client';
import { errorText, useApiQuery, useChange } from '../api/query';
import { settingsPatch, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { RowMenu } from '../ui/RowMenu';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArchiveRestore,
  Bike,
  Car,
  ChevronDown,
  Footprints,
  Motorbike,
  Pencil,
  Plus,
  Scooter,
  Star,
  Van,
  Wrench,
} from 'lucide-react';
import { VehicleMaintenance } from './VehicleMaintenance';
import { VehicleTaxYear } from './VehicleTaxYear';

type Vehicle = Schemas['Vehicle'];
type Kind = Vehicle['kind'];

export const KINDS: { value: Kind; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'ebike', label: 'E-bike' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'walking', label: 'On foot' },
];
const kindLabel = (k: Kind) => KINDS.find((x) => x.value === k)?.label ?? k;

type Ownership = Vehicle['ownership'];
/** 21 section 3.6c: a record for the driver; no rate or tax rule reads it. */
export const OWNERSHIP: { value: Ownership; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'financed', label: 'Financed (loan or hire purchase)' },
  { value: 'leased', label: 'Leased' },
  { value: 'rented', label: 'Rented' },
];
/** Shown on the card only when the vehicle is not owned outright. */
const ownershipNote = (o: Ownership) =>
  o === 'owned' ? '' : (OWNERSHIP.find((x) => x.value === o)?.label ?? '');

const ICONS: Record<Kind, LucideIcon> = {
  car: Car,
  van: Van,
  motorcycle: Motorbike,
  bicycle: Bike,
  ebike: Bike,
  scooter: Scooter,
  walking: Footprints,
};

/** Hints that sit under the Type and Ownership choices, where the question is asked. */
const TYPE_HINT =
  'Sets which mileage rate applies. Bicycles, e-bikes, scooters and walking get none.';
const OWNERSHIP_HINT =
  'For your records. Whether rent or finance payments count for tax depends on your country.';

type Draft = {
  name: string;
  kind: Kind;
  make: string;
  model: string;
  year: string;
  plate: string;
  ownership: Ownership;
};

/**
 * One vehicle as a card (a GOV.UK summary card): its type icon, name and quiet details, the
 * card's actions in the "..." menu, and below a rule this year's deduction and the service log.
 */
function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const saved = useSettings();
  const [edit, setEdit] = useState<Draft | null>(null);
  const change = useChange();
  const { error } = change;
  const [service, setService] = useState(false);
  const titleId = useId();
  const archived = vehicle.archived_at !== null;
  const isDefault = saved.default_vehicle_id === vehicle.id;
  const Icon = ICONS[vehicle.kind] ?? Car;
  const showTax = saved.modules.tax && !archived;
  const showService = saved.modules.maintenance && !archived;

  const makeDefault = () => change.run(...settingsPatch({ default_vehicle_id: vehicle.id }));
  async function act(body: Schemas['VehicleCreate'] | { archived: boolean }) {
    const path = { id: vehicle.id };
    if (await change.run((api) => api.PATCH('/vehicles/{id}', { params: { path }, body })))
      setEdit(null);
  }
  function save(e: FormEvent) {
    e.preventDefault();
    if (edit === null || !edit.name.trim()) return;
    void act({
      name: edit.name.trim(),
      kind: edit.kind,
      make: edit.make.trim() || null,
      model: edit.model.trim() || null,
      year: edit.year.trim() === '' ? null : Number(edit.year),
      plate: edit.plate.trim() || null,
      ownership: edit.ownership,
    });
  }

  const details = [
    kindLabel(vehicle.kind),
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' '),
    vehicle.plate ?? '',
    ownershipNote(vehicle.ownership),
  ].filter(Boolean);

  return (
    <li aria-labelledby={titleId}>
      <Card className={cn(archived && 'bg-muted/40')}>
        <div className="flex items-start gap-3 px-(--card-spacing)">
          <div
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={titleId}
                className={cn(
                  'truncate text-base leading-snug font-medium',
                  archived && 'text-muted-foreground',
                )}
              >
                {vehicle.name}
              </h2>
              {isDefault ? <Badge variant="secondary">Default</Badge> : null}
              {archived ? <Badge variant="outline">Archived</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {details.map((d, i) => (
                <span key={i}>
                  {i > 0 ? ' · ' : null}
                  <span className="whitespace-nowrap">{d}</span>
                </span>
              ))}
            </p>
          </div>
          {edit === null ? (
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
                            ownership: vehicle.ownership,
                          }),
                      },
                    ]),
                ...(archived || isDefault
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
          ) : null}
        </div>
        {edit !== null ? (
          <form
            aria-label={`Edit ${vehicle.name}`}
            className="grid gap-3 border-t px-(--card-spacing) pt-(--card-spacing) sm:grid-cols-2"
            onSubmit={save}
          >
            <Field
              label="Name"
              aria-label={`New name for ${vehicle.name}`}
              maxLength={64}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
            <SelectField
              label="Type"
              name={`Type of ${vehicle.name}`}
              value={edit.kind}
              onChange={(v) => setEdit({ ...edit, kind: v as Kind })}
              options={KINDS}
            />
            {(['make', 'model', 'year', 'plate'] as const).map((k) => {
              const label = `${k[0]!.toUpperCase()}${k.slice(1)}`;
              return (
                <Field
                  key={k}
                  label={label}
                  aria-label={`${label} of ${vehicle.name}`}
                  inputMode={k === 'year' ? 'numeric' : undefined}
                  value={edit[k]}
                  onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                />
              );
            })}
            <SelectField
              label="Ownership"
              name={`Ownership of ${vehicle.name}`}
              hint={OWNERSHIP_HINT}
              value={edit.ownership}
              onChange={(v) => setEdit({ ...edit, ownership: v as Ownership })}
              options={OWNERSHIP}
            />
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={!edit.name.trim()}>
                Save
              </Button>
              <UiButton type="button" variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </UiButton>
            </div>
          </form>
        ) : showTax || showService ? (
          <div className="flex flex-wrap items-start justify-between gap-3 border-t px-(--card-spacing) pt-(--card-spacing)">
            {showTax ? (
              <VehicleTaxYear vehicleId={vehicle.id} name={vehicle.name} kind={vehicle.kind} />
            ) : null}
            {showService ? (
              <UiButton
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={service}
                onClick={() => setService(!service)}
              >
                <Wrench data-icon="inline-start" />
                Service log
                <ChevronDown
                  data-icon="inline-end"
                  className={cn('transition-transform', service && 'rotate-180')}
                />
              </UiButton>
            ) : null}
          </div>
        ) : null}
        {showService && service && edit === null ? (
          <div className="px-(--card-spacing)">
            <VehicleMaintenance vehicleId={vehicle.id} name={vehicle.name} />
          </div>
        ) : null}
        {error ? (
          <div className="px-(--card-spacing)">
            <FormError message={error} />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/**
 * Vehicles (07 section 2.2): the driver's vehicles, each a card. Vehicles are archived, never
 * deleted, because a shift in the tax record points at one. An archived vehicle stays in history
 * and drops out of the pickers. Add vehicle opens the form, as Add expense does.
 */
export function VehiclesPage() {
  const [showArchived, setShowArchived] = useState(false);
  // The list shown stays while the other one (with or without archived) is read.
  const list = useApiQuery(
    '/vehicles',
    { params: { query: { include_archived: showArchived } } },
    { placeholderData: keepPreviousData },
  );
  const vehicles = list.data ?? null;
  const create = useChange();
  const error = errorText(create, list);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('car');
  const [ownership, setOwnership] = useState<Ownership>('owned');
  const busy = create.busy;

  function open() {
    setName('');
    setKind('car');
    setOwnership('owned');
    setAdding(true);
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), kind, ownership };
    if (await create.run((api) => api.POST('/vehicles', { body }))) setAdding(false);
  }

  const addButton = (
    <UiButton type="button" onClick={open}>
      <Plus />
      Add vehicle
    </UiButton>
  );
  const empty = vehicles !== null && vehicles.length === 0;

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader
        title="Vehicles"
        description="What you work with. Archive a vehicle you no longer use; past shifts keep it."
      >
        {adding || empty ? null : addButton}
      </PageHeader>
      {adding ? (
        <Section title="New vehicle">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void add(e)}>
            <div className="sm:col-span-2">
              <Field
                label="Name"
                placeholder="e.g. Corolla"
                autoFocus
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <SelectField
              label="Type"
              hint={TYPE_HINT}
              value={kind}
              onChange={(v) => setKind(v as Kind)}
              options={KINDS}
            />
            <SelectField
              label="Ownership"
              hint={OWNERSHIP_HINT}
              value={ownership}
              onChange={(v) => setOwnership(v as Ownership)}
              options={OWNERSHIP}
            />
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" busy={busy || name.trim() === ''}>
                Add vehicle
              </Button>
              <UiButton type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </UiButton>
            </div>
          </form>
        </Section>
      ) : null}
      <FormError message={error} />
      {vehicles === null ? (
        <p className="text-sm text-muted-foreground">Loading</p>
      ) : empty ? (
        <EmptyState className="space-y-3">
          <p>No vehicles yet. Add the one you drive for work: its type sets the mileage rate.</p>
          {adding ? null : addButton}
        </EmptyState>
      ) : (
        <ul aria-label="Vehicles" className="grid gap-3">
          {vehicles.map((v) => (
            <VehicleCard key={v.id} vehicle={v} />
          ))}
        </ul>
      )}
      <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived vehicles
      </label>
    </section>
  );
}
