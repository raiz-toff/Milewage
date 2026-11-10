import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { Schemas } from '../api/client';
import { slugOf } from '../platforms/usePlatforms';
import { PlatformBadge } from '../platforms/PlatformBadge';
import type { PlatformLike } from '../platforms/PlatformBadge';
import { KINDS, OWNERSHIP } from '../vehicles';
import { parseRate, rateInput } from '../format';
import { settingsPatch } from '../session';
import { Field, SelectField } from '../ui/form';
import { StepError, StepForm } from './StepForm';
import type { StepSave } from './StepForm';
import type { OnboardingCtx, StepProps } from './steps';

type Kind = Schemas['Vehicle']['kind'];
type Ownership = Schemas['Vehicle']['ownership'];

/** The apps the step asks about. The built-in "Other" stays as it is: "Another app" names one. */
export const listedApps = (c: OnboardingCtx) => c.platforms.filter((p) => p.slug !== 'other');

/** Every app starts switched on, so an answer shows as one switched off or one of the driver's own. */
export const appsAnswered = (c: OnboardingCtx) => listedApps(c).some((p) => p.custom || !p.active);

function Tick({
  id,
  label,
  platform,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  /** Shows the platform's badge before the name (plan 25). */
  platform?: PlatformLike;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    // A Material list row: 48 px, the checkbox's 40 px state layer clear of the edge.
    <div className="flex min-h-12 items-center gap-4 pl-[11px]">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="py-3 text-body-large">
        {platform ? <PlatformBadge platform={platform} /> : null}
        {label}
      </Label>
    </div>
  );
}

/** The apps of the driver's country and region, plus their own (plan 23 step 3). */
export function AppsStep({ ctx, next }: StepProps) {
  const listed = listedApps(ctx);
  // Not answered yet: nothing ticked, rather than every app the country lists.
  const [on, setOn] = useState(() =>
    appsAnswered(ctx) ? listed.filter((p) => p.active).map((p) => p.slug) : [],
  );
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const save: StepSave = async (run) => {
    const put = (slug: string, body: Schemas['PlatformPut']) =>
      run((api) => api.PUT('/platforms/{slug}', { params: { path: { slug } }, body }));
    const own = other ? name.trim() : '';
    if (other && !slugOf(own)) throw new StepError('Enter the name of the other app.');
    if (!on.length && !own) return; // nothing ticked: the same as skipping
    for (const p of listed) {
      if (on.includes(p.slug) !== p.active && !(await put(p.slug, { active: on.includes(p.slug) })))
        return false;
    }
    if (own && !(await put(slugOf(own), { label: own }))) return false;
    await ctx.reload();
  };
  return (
    <StepForm save={save} next={next}>
      <fieldset className="grid">
        <legend className="mb-2 text-body-medium text-on-surface-variant">
          Choose every app you work for. Earnings and reports list only these.
        </legend>
        {listed.map((p) => (
          <Tick
            key={p.slug}
            id={`app-${p.slug}`}
            label={p.label}
            platform={p}
            checked={on.includes(p.slug)}
            onChange={(v) =>
              setOn((list) => (v ? [...list, p.slug] : list.filter((s) => s !== p.slug)))
            }
          />
        ))}
        <Tick id="app-other" label="Another app" checked={other} onChange={setOther} />
        {other ? (
          <Field
            label="Name of the app"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : null}
      </fieldset>
    </StepForm>
  );
}

/** Same rule as the server's `notAutomobile` (18 section 4.1): no allowance rate applies. */
const NO_RATE: Kind[] = ['bicycle', 'ebike', 'scooter', 'walking'];

/** Which rate will value this vehicle's distance, in one line; "official" only once checked. */
export function rateLine(kind: Kind, country: OnboardingCtx['country']) {
  if (NO_RATE.includes(kind))
    return 'Bicycles, e-bikes, scooters and walking have no mileage rate.';
  if (!country || country.supports.mileage) {
    const where = country ? ` for ${country.name}` : '';
    return country?.verified
      ? `Uses the official mileage rate${where}.`
      : `Uses the mileage rate${where} (not yet checked against the official publications).`;
  }
  return 'No official rate here: you can set your own rate.';
}

/** The vehicle (plan 23 step 4): a shift needs one, so it is skippable only once one exists. */
export function VehicleStep({ ctx, next }: StepProps) {
  const { settings, country, vehicles } = ctx;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('car');
  const [ownership, setOwnership] = useState<Ownership>('owned');
  const was = settings.own_mileage_rate
    ? rateInput(settings.own_mileage_rate.cents_per_unit, settings.currency)
    : '';
  const [rate, setRate] = useState(was);
  const ownRate = country?.supports.mileage === false && !NO_RATE.includes(kind);

  const save: StepSave = async (run) => {
    if (!name.trim() && !vehicles.length) throw new StepError('Enter a name for your vehicle.');
    if (ownRate && rate !== was) {
      const n = Number(rate);
      if (rate !== '' && !(n > 0)) throw new StepError('Enter your rate as a number above 0.');
      const rated = await run(
        ...settingsPatch({
          own_mileage_rate:
            rate === ''
              ? null
              : {
                  cents_per_unit: parseRate(rate, settings.currency),
                  unit: settings.distance_unit,
                },
        }),
      );
      if (!rated) return false;
    }
    if (name.trim()) {
      const body = { name: name.trim(), kind, ownership };
      if (!(await run((api) => api.POST('/vehicles', { body })))) return false;
      await ctx.reload();
    }
  };
  return (
    <StepForm save={save} next={next} skip={vehicles.length ? 'Skip this step' : null}>
      {vehicles.length ? (
        <p className="text-sm text-muted-foreground">
          Your vehicles: {vehicles.map((v) => v.name).join(', ')}. You can add another one or
          continue.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">A shift is recorded with a vehicle.</p>
      )}
      <Field
        label="Name"
        hint="For example, Civic or Work bike."
        maxLength={64}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <SelectField label="Type" value={kind} onChange={(v) => setKind(v as Kind)} options={KINDS} />
      <SelectField
        label="Ownership"
        value={ownership}
        onChange={(v) => setOwnership(v as Ownership)}
        options={OWNERSHIP}
      />
      <p role="note" className="text-sm">
        {rateLine(kind, country)}
      </p>
      {ownRate ? (
        <Field
          label={`Your mileage rate (${settings.currency} per ${settings.distance_unit})`}
          hint="Optional. Deductions at your rate are always labelled your rate, never official."
          type="number"
          min={0}
          step="any"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      ) : null}
    </StepForm>
  );
}
