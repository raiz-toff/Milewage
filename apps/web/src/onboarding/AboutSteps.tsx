import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { levelWord } from '../countries';
import { useSession } from '../session';
import { SelectField } from '../ui/form';
import { StepForm } from './StepForm';
import type { StepProps } from './steps';

/** Sends a settings change and keeps the answer in the session, so `done` sees it. */
export function useSaveSettings() {
  const { api, setSettings } = useSession();
  return async (body: Schemas['SettingsPatch']) =>
    setSettings(await unwrap(api.PATCH('/settings', { body })));
}

/** Region (province, state, nation): optional; skipping keeps the national rules (plan 21 Q4). */
export function RegionStep({ ctx, next }: StepProps) {
  const saveSettings = useSaveSettings();
  const country = ctx.country!;
  const word = levelWord(country);
  const [region, setRegion] = useState(ctx.settings.region ?? '');
  const save = async () => {
    if (region === (ctx.settings.region ?? '')) return;
    await saveSettings({ region: region || null });
    await ctx.reload(); // a region can add or remove apps
  };
  return (
    <StepForm save={save} next={next}>
      <p className="text-sm text-muted-foreground">
        {country.regional_rules
          ? `Some places in ${country.name} have their own rules. Until you choose your ${word.toLowerCase()}, only the national rules apply.`
          : 'You can change this later in Settings.'}
      </p>
      <SelectField
        label={word}
        value={region}
        onChange={setRegion}
        options={[
          { value: '', label: 'Not set' },
          ...country.regions.map((r) => ({ value: r.code, label: r.name })),
        ]}
      />
    </StepForm>
  );
}

type WorkKind = Schemas['WorkKind'];
const WORK_LABELS: Record<WorkKind, string> = {
  delivery: 'Delivery: food, groceries or parcels',
  ride_hailing: 'Ride-hailing: driving passengers',
  moto_taxi: 'Motorcycle taxi',
  courier: 'Courier: documents and packages',
};

/** The kinds of work the country's data covers; shown only when there is more than one. */
export function WorkStep({ ctx, next }: StepProps) {
  const saveSettings = useSaveSettings();
  const offered = ctx.country!.work;
  const [chosen, setChosen] = useState<WorkKind[]>(ctx.settings.work_kinds);
  const toggle = (k: WorkKind, on: boolean) =>
    setChosen((list) => offered.filter((o) => (o === k ? on : list.includes(o))));
  const save = async () => {
    if (chosen.length) await saveSettings({ work_kinds: chosen });
  };
  return (
    <StepForm save={save} next={next}>
      <fieldset className="grid gap-3">
        <legend className="mb-3 text-sm text-muted-foreground">Choose all that apply.</legend>
        {offered.map((k) => (
          <div key={k} className="flex items-center gap-3">
            <Checkbox
              id={`work-${k}`}
              checked={chosen.includes(k)}
              onCheckedChange={(v) => toggle(k, v === true)}
            />
            <Label htmlFor={`work-${k}`}>{WORK_LABELS[k]}</Label>
          </div>
        ))}
      </fieldset>
    </StepForm>
  );
}
