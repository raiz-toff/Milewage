import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { FormEvent, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { describe, unwrap } from '../api/client';
import { levelWord, useCountries } from '../countries';
import type { Schemas, Settings } from '../api/client';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { Account } from './Account';
import { ImportCard } from './Import';
import { AlertsCard } from './Notifications';
import { PlatformsCard } from './Platforms';

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
  /** The driver's own mileage rate in major units (0.30), or ''. */
  own_rate: string;
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
  own_rate: s.own_mileage_rate ? String(s.own_mileage_rate.cents_per_unit / 100) : '',
});

/** Only the fields that differ from the saved settings, so a save never rewrites the rest. */
export function changes(saved: Settings, draft: Draft): Patch {
  const was = draftOf(saved);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (draft[key] === was[key]) continue;
    const v = draft[key];
    if (key === 'own_rate') {
      patch.own_mileage_rate =
        v === ''
          ? null
          : { cents_per_unit: Math.round(Number(v) * 10_000) / 100, unit: draft.distance_unit };
      continue;
    }
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
    [
      'sync',
      'devices',
      'tracking',
      'replay',
      'stops',
      'diagnostics',
      'capture',
      'platforms',
    ] as const
  ).map((k) => [k, modules[k]] as const);
  return (
    <SettingsCard
      title="Modules"
      description="Set when the server starts; they cannot be changed here."
    >
      <section aria-label="Modules" className="space-y-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {flags.map(([name, on]) => (
            <li
              key={name}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="tabular-nums text-xs">{name}</span>
              <Badge variant={on ? 'default' : 'outline'}>{on ? 'On' : 'Off'}</Badge>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Exporters</span>
          {modules.exporters.length > 0 ? (
            modules.exporters.map((f) => (
              <Badge key={f} variant="secondary" className="tabular-nums">
                {f}
              </Badge>
            ))
          ) : (
            <span>none</span>
          )}
        </div>
      </section>
    </SettingsCard>
  );
}

type SectionId =
  'general' | 'units' | 'tracking' | 'account' | 'platforms' | 'import' | 'alerts' | 'modules';

const SECTIONS: {
  id: SectionId;
  label: string;
  module?: 'platforms' | 'import' | 'notifications';
}[] = [
  { id: 'general', label: 'General' },
  { id: 'units', label: 'Units and format' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'account', label: 'Account' },
  { id: 'platforms', label: 'Platforms', module: 'platforms' },
  { id: 'import', label: 'Import', module: 'import' },
  { id: 'alerts', label: 'Alerts', module: 'notifications' },
  { id: 'modules', label: 'Modules' },
];

function SettingsCard({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      {title ? (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The saved preferences and the unsaved draft, shared by the General, Units and Tracking pages. */
function usePrefs() {
  const { api, setSettings } = useSession();
  const saved = useSettings();
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = changes(saved, draft);
  return {
    saved,
    draft,
    error,
    note,
    busy,
    dirty: Object.keys(patch).length > 0,
    set(p: Partial<Draft>) {
      setNote(null);
      setDraft((d) => ({ ...d, ...p }));
    },
    discard() {
      setError(null);
      setDraft(draftOf(saved));
    },
    async save(e: FormEvent) {
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
    },
  };
}

type Prefs = ReturnType<typeof usePrefs>;

/** A preferences page: its card plus the save bar. Unsaved edits from the other pages are saved too. */
function PrefsForm({ prefs, children }: { prefs: Prefs; children: ReactNode }) {
  const { dirty, busy, error, note } = prefs;
  return (
    <form onSubmit={(e) => void prefs.save(e)} className="space-y-6">
      {children}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3',
          dirty && 'sticky bottom-4 z-10 border-primary/40 shadow-lg backdrop-blur',
        )}
      >
        <div className="min-h-5 text-sm">
          {error ? (
            <FormError message={error} />
          ) : note ? (
            <p role="status" className="text-muted-foreground">
              {note}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <UiButton type="button" variant="ghost" disabled={!dirty || busy} onClick={prefs.discard}>
            Discard
          </UiButton>
          <Button type="submit" busy={busy || !dirty}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function GeneralSection({ prefs }: { prefs: Prefs }) {
  const { draft, set, saved } = prefs;
  const tree = useCountries();
  const countries = saved.modules.countries.includes(draft.country)
    ? saved.modules.countries
    : [draft.country, ...saved.modules.countries];
  const country = tree.find((c) => c.code === draft.country);
  const regions = country?.regions ?? [];
  const word = levelWord(country);
  return (
    <SettingsCard title="General" description="How you appear and where you drive.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Name"
            maxLength={64}
            value={draft.display_name}
            onChange={(e) => set({ display_name: e.target.value })}
          />
        </div>
        <SelectField
          label="Country"
          value={draft.country}
          // A region belongs to its country, so a new country starts without one.
          onChange={(v) => set({ country: v, region: '' })}
          options={countries.map((c) => ({
            value: c,
            label: tree.find((t) => t.code === c)?.name ?? c,
          }))}
        />
        {regions.length > 0 ? (
          <SelectField
            label={word}
            value={draft.region}
            onChange={(v) => set({ region: v })}
            options={[
              { value: '', label: 'Not set' },
              ...regions.map((r) => ({ value: r.code, label: r.name })),
            ]}
          />
        ) : tree.length === 0 ? (
          <Field
            label="Region"
            hint="Province or state code, for example ON."
            maxLength={3}
            value={draft.region}
            onChange={(e) => set({ region: e.target.value.toUpperCase() })}
          />
        ) : null}
        {country && !country.supports.mileage ? (
          <div className="sm:col-span-2">
            <Field
              label={`Your mileage rate (${draft.currency} per ${draft.distance_unit})`}
              hint="MileWage has no official rate for this country. Deductions use your rate and are always labelled your rate, never official."
              type="number"
              min={0}
              step="any"
              value={draft.own_rate}
              onChange={(e) => set({ own_rate: e.target.value })}
            />
          </div>
        ) : null}
        {country?.regional_rules && !draft.region ? (
          <p role="note" className="text-sm text-muted-foreground sm:col-span-2">
            Set your {word.toLowerCase()} to include its own rules. Until then, only the national
            rules apply.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

function UnitsSection({ prefs }: { prefs: Prefs }) {
  const { draft, set } = prefs;
  return (
    <SettingsCard
      title="Units and format"
      description="How distances, money, dates and times are shown."
    >
      <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="sm:col-span-2">
          <Field
            label="Time zone"
            hint="A change applies to shifts started afterwards."
            value={draft.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          />
        </div>
      </div>
    </SettingsCard>
  );
}

function TrackingSection({ prefs }: { prefs: Prefs }) {
  const { draft, set, saved } = prefs;
  return (
    <SettingsCard title="Tracking" description="What the server keeps from your phone's GPS.">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <label htmlFor="stops-enabled" className="text-sm font-medium">
              Detect stops and estimate active vs deadhead
            </label>
            <p className="text-sm text-muted-foreground">
              Shifts started afterwards follow this. Past shifts, stored stops and labels do not
              change.
            </p>
          </div>
          <Switch
            id="stops-enabled"
            checked={draft.stops_enabled}
            onCheckedChange={(on) => set({ stops_enabled: on })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Keep raw GPS points (days)"
            hint="At least 7 days."
            type="number"
            min={7}
            value={draft.raw_retention_days}
            onChange={(e) => set({ raw_retention_days: e.target.value })}
          />
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
        </div>
      </div>
    </SettingsCard>
  );
}

/** Settings, one page per section under /settings/<section>; /settings opens General. */
export function SettingsPage() {
  const prefs = usePrefs();
  const { modules } = prefs.saved;
  const sections = SECTIONS.filter((s) => !s.module || modules[s.module]);

  const pages: Record<SectionId, ReactNode> = {
    general: (
      <PrefsForm prefs={prefs}>
        <GeneralSection prefs={prefs} />
      </PrefsForm>
    ),
    units: (
      <PrefsForm prefs={prefs}>
        <UnitsSection prefs={prefs} />
      </PrefsForm>
    ),
    tracking: (
      <PrefsForm prefs={prefs}>
        <TrackingSection prefs={prefs} />
      </PrefsForm>
    ),
    account: (
      <SettingsCard>
        <Account />
      </SettingsCard>
    ),
    platforms: (
      <SettingsCard>
        <PlatformsCard />
      </SettingsCard>
    ),
    import: (
      <SettingsCard>
        <ImportCard />
      </SettingsCard>
    ),
    alerts: (
      <SettingsCard>
        <AlertsCard />
      </SettingsCard>
    ),
    modules: <ModuleFlags modules={modules} />,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your profile, units, tracking and account on this server.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label="Settings sections"
          className="-mx-1 overflow-x-auto lg:sticky lg:top-20 lg:mx-0 lg:self-start lg:overflow-visible"
        >
          <ul className="flex gap-1 px-1 text-sm lg:flex-col lg:px-0">
            {sections.map((s) => (
              <li key={s.id} className="shrink-0">
                <NavLink
                  to={`/settings/${s.id}`}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-1.5 whitespace-nowrap transition-colors',
                      isActive
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="max-w-3xl min-w-0">
          <Routes>
            {sections.map((s) => (
              <Route key={s.id} path={s.id} element={pages[s.id]} />
            ))}
            <Route path="*" element={<Navigate to="/settings/general" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
