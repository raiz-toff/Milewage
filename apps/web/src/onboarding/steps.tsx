import type { ComponentType } from 'react';
import type { Schemas, Settings } from '../api/client';
import type { Country } from '../countries';
import { RegionStep, WORK_LABELS, WorkStep } from './AboutSteps';
import { AppStep } from './AppStep';
import { CheckStep } from './CheckStep';
import { PairStep } from './PhoneSteps';
import { AppsStep, appsAnswered, listedApps, VehicleStep } from './SetupSteps';

/** What the steps decide from: the server's own data, read when the wizard opens (plan 23 rule 3). */
export interface OnboardingCtx {
  settings: Settings;
  /** The driver's country from `GET /countries`; undefined if the list could not be read. */
  country: Country | undefined;
  /** Every platform the driver could use, switched off ones too (module `platforms`). */
  platforms: Schemas['Platform'][];
  /** Active vehicles. */
  vehicles: Schemas['Vehicle'][];
  /** Phones not revoked (module `devices`). */
  devices: Schemas['Device'][];
  /** Read the data again; a step calls it after saving. */
  reload: () => Promise<void>;
}

export interface StepProps {
  ctx: OnboardingCtx;
  /** Go to the next step (or finish after the last); call after the answer is saved. */
  next: () => void | Promise<void>;
  /** The visible steps, in order. */
  steps: Step[];
}

/**
 * One step of the wizard (plan 23 section 4.2). A step whose question has one possible answer is
 * not visible (rule 1); `done` is read from server state, so the driver can leave and come back.
 */
export interface Step {
  id: string;
  title: string;
  visible: (ctx: OnboardingCtx) => boolean;
  done: (ctx: OnboardingCtx) => boolean;
  /** The answer in a few words, for "Check your answers". */
  summary?: (ctx: OnboardingCtx) => string;
  Component: ComponentType<StepProps>;
}

const list = (items: string[], none = 'Not set') => (items.length ? items.join(', ') : none);

/** The steps, in order. A new step is one entry here. */
export const STEPS: Step[] = [
  {
    id: 'region',
    title: 'Where you drive',
    visible: (c) => (c.country?.regions.length ?? 0) > 0,
    done: (c) => c.settings.region !== null,
    summary: (c) => c.country?.regions.find((r) => r.code === c.settings.region)?.name ?? 'Not set',
    Component: RegionStep,
  },
  {
    id: 'work',
    title: 'What work you do',
    visible: (c) => (c.country?.work.length ?? 0) > 1,
    done: (c) => c.settings.work_kinds.length > 0,
    summary: (c) => list(c.settings.work_kinds.map((k) => WORK_LABELS[k])),
    Component: WorkStep,
  },
  {
    id: 'apps',
    title: 'Your apps',
    visible: (c) => c.settings.modules.platforms,
    done: appsAnswered,
    summary: (c) =>
      list(
        listedApps(c)
          .filter((p) => p.active)
          .map((p) => p.label),
      ),
    Component: AppsStep,
  },
  {
    id: 'vehicle',
    title: 'Your vehicle',
    visible: () => true,
    done: (c) => c.vehicles.length > 0,
    summary: (c) => list(c.vehicles.map((v) => v.name)),
    Component: VehicleStep,
  },
  {
    // No answer to save, so no summary on Check your answers; done once a phone has paired.
    id: 'app',
    title: 'Get the app',
    visible: (c) => c.settings.modules.devices,
    done: (c) => c.devices.length > 0,
    Component: AppStep,
  },
  {
    id: 'phone',
    title: 'Pair your phone',
    visible: (c) => c.settings.modules.devices,
    done: (c) => c.devices.length > 0,
    summary: (c) =>
      list(
        c.devices.map((d) => d.name),
        'Not paired',
      ),
    Component: PairStep,
  },
  {
    id: 'check',
    title: 'Check your answers',
    visible: () => true,
    done: (c) => c.settings.onboarded_at !== null,
    Component: CheckStep,
  },
];
