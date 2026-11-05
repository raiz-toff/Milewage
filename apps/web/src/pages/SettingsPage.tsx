import { useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { Account } from './Account';

type Patch = Schemas['SettingsPatch'];

interface Draft {
  country: string;
  distance_unit: 'km' | 'mi';
  currency: string;
  timezone: string;
  raw_retention_days: string;
  stops_enabled: boolean;
  diagnostics_level: 'off' | 'basic' | 'verbose';
  display_name: string;
  region: string;
  week_start: '0' | '1';
  time_format: '12h' | '24h';
}

const draftOf = (s: Settings): Draft => ({
  country: s.country,
  distance_unit: s.distance_unit,
  currency: s.currency,
  timezone: s.timezone,
  raw_retention_days: String(s.raw_retention_days),
  stops_enabled: s.stops_enabled,
  diagnostics_level: s.diagnostics.level,
  display_name: s.display_name ?? '',
  region: s.region ?? '',
  week_start: s.week_start === 0 ? '0' : '1',
  time_format: s.time_format,
});

/** Only the fields that differ from the saved settings, so a save never rewrites the rest. */
export function changes(saved: Settings, draft: Draft): Patch {
  const was = draftOf(saved);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (draft[key] === was[key]) continue;
    const v = draft[key];
    patch[key] =
      key === 'raw_retention_days' || key === 'week_start'
        ? Number(v)
        : key === 'display_name' || key === 'region'
          ? v === ''
            ? null
            : v
          : v;
  }
  return patch as Patch;
}

/** The read-only module list: what this server runs, so the driver can see why a screen is absent. */
function ModuleFlags({ modules }: { modules: Settings['modules'] }) {
  const flags = (
    ['sync', 'devices', 'tracking', 'replay', 'live', 'stops', 'diagnostics', 'capture'] as const
  ).map((k) => [k, modules[k]] as const);
  return (
    <section aria-label="Modules" className="space-y-2">
      <h2 className="font-heading text-lg">Modules</h2>
      <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
        {flags.map(([name, on]) => (
          <li key={name} className={on ? 'text-ink' : 'text-muted'}>
            {name}: {on ? 'on' : 'off'}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Exporters: {modules.exporters.join(', ') || 'none'}</p>
      <p className="text-xs text-muted">
        Modules are set when the server starts and cannot be changed here.
      </p>
    </section>
  );
}

export function SettingsPage() {
  const { api, setSettings } = useSession();
  const saved = useSettings();
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => {
    setNote(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const patch = changes(saved, draft);
  const dirty = Object.keys(patch).length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await unwrap(api.PATCH('/settings', { body: patch }));
      setSettings(next);
      setDraft(draftOf(next));
      setNote('Saved.');
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  const countries = saved.modules.countries.includes(draft.country)
    ? saved.modules.countries
    : [draft.country, ...saved.modules.countries];

  return (
    <section className="max-w-xl space-y-6">
      <h1 className="font-heading text-2xl">Settings</h1>
      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <SelectField
          label="Country"
          value={draft.country}
          onChange={(v) => set({ country: v })}
          options={countries.map((c) => ({ value: c, label: c }))}
        />
        <Field
          label="Name"
          maxLength={64}
          value={draft.display_name}
          onChange={(e) => set({ display_name: e.target.value })}
        />
        <Field
          label="Region"
          hint="Province or state code, for example ON or QC."
          maxLength={3}
          value={draft.region}
          onChange={(e) => set({ region: e.target.value.toUpperCase() })}
        />
        <SelectField
          label="Week starts on"
          value={draft.week_start}
          onChange={(v) => set({ week_start: v === '0' ? '0' : '1' })}
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
        />
        <SelectField
          label="Time format"
          value={draft.time_format}
          onChange={(v) => set({ time_format: v === '12h' ? '12h' : '24h' })}
          options={[
            { value: '24h', label: '24-hour' },
            { value: '12h', label: '12-hour' },
          ]}
        />
        <SelectField
          label="Distance unit"
          value={draft.distance_unit}
          onChange={(v) => set({ distance_unit: v === 'mi' ? 'mi' : 'km' })}
          options={[
            { value: 'km', label: 'Kilometres' },
            { value: 'mi', label: 'Miles' },
          ]}
        />
        <Field
          label="Currency"
          maxLength={3}
          value={draft.currency}
          onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
        />
        <Field
          label="Time zone"
          hint="A change applies to shifts started afterwards."
          value={draft.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
        />
        <Field
          label="Keep raw GPS points (days)"
          type="number"
          min={7}
          value={draft.raw_retention_days}
          onChange={(e) => set({ raw_retention_days: e.target.value })}
        />
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 accent-[var(--mw-accent)]"
            checked={draft.stops_enabled}
            onChange={(e) => set({ stops_enabled: e.target.checked })}
          />
          <span>
            <span className="block">Detect stops and estimate active vs deadhead</span>
            <span className="block text-sm text-muted">
              Shifts started afterwards follow this. Past shifts, stored stops and labels do not
              change.
            </span>
          </span>
        </label>
        {saved.modules.diagnostics ? (
          <SelectField
            label="Diagnostics level"
            value={draft.diagnostics_level}
            onChange={(v) =>
              set({ diagnostics_level: v === 'off' || v === 'verbose' ? v : 'basic' })
            }
            options={[
              { value: 'off', label: 'Off' },
              { value: 'basic', label: 'Basic' },
              { value: 'verbose', label: 'Verbose (returns to basic after 7 days)' },
            ]}
          />
        ) : null}
        <FormError message={error} />
        {note ? (
          <p role="status" className="text-sm text-accent">
            {note}
          </p>
        ) : null}
        <Button type="submit" busy={busy || !dirty}>
          Save
        </Button>
      </form>
      <Account />
      <ModuleFlags modules={saved.modules} />
    </section>
  );
}
