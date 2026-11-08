import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { describe, unwrap } from '../api/client';
import { levelWord, useCountries } from '../countries';
import type { Schemas, Settings } from '../api/client';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { PageHeader } from '../ui/layout';
import { Account } from './Account';
import { ImportCard } from './Import';
import { AlertsCard } from './Notifications';
import { PlatformsCard } from './Platforms';
import { InstallSection } from '../pwa/Install';

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
    <SettingsCard>
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
  | 'profile'
  | 'units'
  | 'alerts'
  | 'app'
  | 'platforms'
  | 'tracking'
  | 'data'
  | 'account'
  | 'modules';

/** How a section keeps its changes; said under its heading so nobody wonders. */
const SAVES = {
  shared:
    'Saved with the Save button below, together with unsaved changes in the other sections that use it.',
  instant: 'Each change is saved at once.',
  own: 'Uses its own button, not the Save bar of the preferences.',
} as const;

interface Section {
  id: SectionId;
  label: string;
  description: string;
  saves?: keyof typeof SAVES;
  /** Shown only when this module runs on the server. */
  module?: 'platforms' | 'notifications';
}

/** The settings sections in groups, in order. One topic per section, one URL each. */
const GROUPS: { label: string; sections: Section[] }[] = [
  {
    label: 'Preferences',
    sections: [
      {
        id: 'profile',
        label: 'Profile and region',
        description: 'Your name, and the country and region whose mileage and tax rules apply.',
        saves: 'shared',
      },
      {
        id: 'units',
        label: 'Units and format',
        description: 'How distances, money, dates and times are shown.',
        saves: 'shared',
      },
      {
        id: 'alerts',
        label: 'Alerts',
        description: 'What MileWage tells you about, here and on the phone.',
        saves: 'instant',
        module: 'notifications',
      },
      {
        id: 'app',
        label: 'App on this device',
        description: 'Install MileWage so it opens in its own window, like an app.',
      },
    ],
  },
  {
    label: 'Work and tracking',
    sections: [
      {
        id: 'platforms',
        label: 'Platforms',
        description: 'The apps you work for. Active ones are offered when you label shifts.',
        saves: 'instant',
        module: 'platforms',
      },
      {
        id: 'tracking',
        label: 'Tracking and privacy',
        description: "What the server works out from your phone's GPS, and how long it keeps it.",
        saves: 'shared',
      },
    ],
  },
  {
    label: 'Data and account',
    sections: [
      {
        id: 'data',
        label: 'Your data',
        description: 'Bring records in, and where to find backups and exports.',
      },
      {
        id: 'account',
        label: 'Account and security',
        description: 'Your password, and the phones that can send data to this server.',
        saves: 'own',
      },
      {
        id: 'modules',
        label: 'Server modules',
        description:
          'What this server runs. They are set when the server starts and are read only here.',
      },
    ],
  },
];

/** Old section addresses, kept working. */
const MOVED: Record<string, SectionId> = { general: 'profile', import: 'data' };

/** Which section each preference belongs to, to say where unsaved changes are. */
const FIELD_SECTION: Record<keyof Draft, SectionId> = {
  display_name: 'profile',
  country: 'profile',
  region: 'profile',
  own_rate: 'profile',
  distance_unit: 'units',
  currency: 'units',
  week_start: 'units',
  time_format: 'units',
  timezone: 'units',
  stops_enabled: 'tracking',
  raw_retention_days: 'tracking',
  diagnostics_level: 'tracking',
};

const ALL_SECTIONS = GROUPS.flatMap((g) => g.sections);
const labelOf = (id: SectionId) => ALL_SECTIONS.find((s) => s.id === id)?.label ?? id;

/** Groups with only the sections whose module is on; a group left empty is dropped. */
const visibleGroups = (modules: Settings['modules']) =>
  GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter((s) => !s.module || modules[s.module]),
  })).filter((g) => g.sections.length > 0);

type Group = ReturnType<typeof visibleGroups>[number];

/**
 * The section list. Where there is room it is a grouped list beside the form that stays in view;
 * where there is not, one menu button that names the open section. Neither ever scrolls sideways.
 */
function SettingsNav({ groups }: { groups: Group[] }) {
  const { pathname } = useLocation();
  const sections = groups.flatMap((g) => g.sections);
  const current = sections.find((s) => pathname.startsWith(`/settings/${s.id}`)) ?? sections[0];
  return (
    <nav
      aria-label="Settings sections"
      className="@2xl:sticky @2xl:top-20 @2xl:max-h-[calc(100svh-6rem)] @2xl:self-start @2xl:overflow-y-auto @2xl:[scrollbar-width:thin]"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <UiButton variant="outline" className="w-full justify-between @md:w-72 @2xl:hidden">
            <span className="truncate">
              <span className="text-muted-foreground">Section:</span> {current?.label}
            </span>
            <ChevronDown />
          </UiButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-(--radix-dropdown-menu-trigger-width)">
          {groups.map((g, i) => (
            <DropdownMenuGroup key={g.label}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {g.label}
              </DropdownMenuLabel>
              {g.sections.map((s) => (
                <DropdownMenuItem key={s.id} asChild>
                  <Link
                    to={`/settings/${s.id}`}
                    aria-current={s === current ? 'page' : undefined}
                    className="aria-[current=page]:font-medium"
                  >
                    {s.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="hidden space-y-4 text-sm @2xl:block">
        {groups.map((g, i) => (
          <div key={g.label} className="space-y-1">
            <p
              id={`settings-group-${i}`}
              className="px-3 text-xs font-medium text-muted-foreground"
            >
              {g.label}
            </p>
            <ul aria-labelledby={`settings-group-${i}`} className="flex flex-col gap-1">
              {g.sections.map((s) => (
                <li key={s.id}>
                  <NavLink
                    to={`/settings/${s.id}`}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-md px-3 py-1.5 transition-colors',
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
          </div>
        ))}
      </div>
    </nav>
  );
}

/** The top of a section: its name, what it is for and how it saves. */
function SectionHeader({ section }: { section: Section }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
      <p className="text-sm text-muted-foreground">{section.description}</p>
      {section.saves ? (
        <p className="text-xs text-muted-foreground">{SAVES[section.saves]}</p>
      ) : null}
    </div>
  );
}

/** A row that leads to another page of the app. */
function LinkRow({ to, title, children }: { to: string; title: string; children: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted"
      >
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{children}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The saved preferences and the unsaved draft, shared by the Profile, Units and Tracking pages. */
function usePrefs() {
  const { api, setSettings } = useSession();
  const saved = useSettings();
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = changes(saved, draft);
  const was = draftOf(saved);
  const edited = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== was[k]);
  return {
    /** Sections with edits not yet saved, in menu order. */
    unsaved: ALL_SECTIONS.map((s) => s.id).filter((id) =>
      edited.some((k) => FIELD_SECTION[k] === id),
    ),
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
              {dirty
                ? `Unsaved changes: ${prefs.unsaved.map(labelOf).join(', ')}.`
                : 'All changes saved.'}
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

function ProfileSection({ prefs }: { prefs: Prefs }) {
  const { draft, set, saved } = prefs;
  const tree = useCountries();
  const countries = saved.modules.countries.includes(draft.country)
    ? saved.modules.countries
    : [draft.country, ...saved.modules.countries];
  const country = tree.find((c) => c.code === draft.country);
  const regions = country?.regions ?? [];
  const word = levelWord(country);
  return (
    <SettingsCard>
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
    <SettingsCard>
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
    <SettingsCard>
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

/**
 * Opens the onboarding wizard again at its first step (plan 23 section 4.4). The driver stays
 * onboarded, so leaving half-way returns to the app; Finish keeps the first time.
 */
function RunSetupAgain() {
  return (
    <SettingsCard>
      <section aria-label="Setup" className="space-y-3">
        <h3 className="text-base leading-snug font-medium">Setup</h3>
        <p className="text-sm text-muted-foreground">
          Go through the first-run questions again. Your answers stay until you change them.
        </p>
        <UiButton variant="outline" asChild>
          <Link to="/onboarding/start">Run setup again</Link>
        </UiButton>
      </section>
    </SettingsCard>
  );
}

/** Settings, one page per section under /settings/<section>; /settings opens the first. */
export function SettingsPage() {
  const prefs = usePrefs();
  const { modules } = prefs.saved;
  const groups = visibleGroups(modules);
  const first = groups[0]!.sections[0]!.id;

  const pages: Record<SectionId, ReactNode> = {
    profile: (
      <>
        <PrefsForm prefs={prefs}>
          <ProfileSection prefs={prefs} />
        </PrefsForm>
        <RunSetupAgain />
      </>
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
    alerts: (
      <SettingsCard>
        <AlertsCard />
      </SettingsCard>
    ),
    app: (
      <SettingsCard>
        <InstallSection />
      </SettingsCard>
    ),
    platforms: (
      <SettingsCard>
        <PlatformsCard />
      </SettingsCard>
    ),
    data: (
      <>
        {modules.import ? (
          <SettingsCard>
            <ImportCard />
          </SettingsCard>
        ) : null}
        <Card className="py-0">
          <ul aria-label="Elsewhere in MileWage" className="divide-y">
            <LinkRow to="/backups" title="Backups">
              Encrypted copies of all your data: make one, download it, check the last run.
            </LinkRow>
            {modules.exporters.length > 0 ? (
              <LinkRow to="/exports" title="Exports">
                Files of your shifts, trips and totals for your records or an accountant.
              </LinkRow>
            ) : null}
          </ul>
        </Card>
      </>
    ),
    account: (
      <>
        <SettingsCard>
          <Account />
        </SettingsCard>
        {modules.devices ? (
          <Card className="py-0">
            <ul aria-label="Elsewhere in MileWage">
              <LinkRow to="/devices" title="Devices">
                The phones paired with this server. Revoke one you lost or replaced.
              </LinkRow>
            </ul>
          </Card>
        ) : null}
      </>
    ),
    modules: <ModuleFlags modules={modules} />,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your preferences, the apps you work for, tracking, your data and your account."
      />
      {/* Sized by its own width, not the window's: the side list needs room beside the form. */}
      <div className="@container">
        <div className="grid gap-6 @2xl:grid-cols-[200px_minmax(0,1fr)] @2xl:gap-8">
          <SettingsNav groups={groups} />
          <div className="max-w-3xl min-w-0">
            <Routes>
              {groups
                .flatMap((g) => g.sections)
                .map((s) => (
                  <Route
                    key={s.id}
                    path={s.id}
                    element={
                      <div className="space-y-4">
                        <SectionHeader section={s} />
                        {pages[s.id]}
                      </div>
                    }
                  />
                ))}
              {Object.entries(MOVED).map(([from, to]) => (
                <Route
                  key={from}
                  path={from}
                  element={<Navigate to={`/settings/${to}`} replace />}
                />
              ))}
              <Route path="*" element={<Navigate to={`/settings/${first}`} replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}
