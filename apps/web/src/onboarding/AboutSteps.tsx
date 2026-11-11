import { useState } from 'react';
import { levelWord } from '../countries';
import { settingsPatch } from '../session';
import { SelectField } from '../ui/form';
import { StepForm } from './StepForm';
import type { StepSave } from './StepForm';
import type { StepProps } from './steps';

/** Region (province, state, nation): optional; skipping keeps the national rules (plan 21 Q4). */
export function RegionStep({ ctx, next }: StepProps) {
  const country = ctx.country!;
  const word = levelWord(country);
  const [region, setRegion] = useState(ctx.settings.region ?? '');
  const save: StepSave = async (run) => {
    if (region === (ctx.settings.region ?? '')) return;
    if (!(await run(...settingsPatch({ region: region || null })))) return false;
    await ctx.reload(); // a region can add or remove apps
  };
  return (
    <StepForm save={save} next={next}>
      <p className="text-body-medium text-muted-foreground">
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
