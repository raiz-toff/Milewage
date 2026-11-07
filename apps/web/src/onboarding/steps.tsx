import type { ComponentType } from 'react';
import type { Schemas, Settings } from '../api/client';
import type { Country } from '../countries';
import { RegionStep, WorkStep } from './AboutSteps';
import { AppsStep, appsAnswered, VehicleStep } from './SetupSteps';

/** What the steps decide from: the server's own data, read when the wizard opens (plan 23 rule 3). */
export interface OnboardingCtx {
  settings: Settings;
  /** The driver's country from `GET /countries`; undefined if the list could not be read. */
  country: Country | undefined;
  /** Every platform the driver could use, switched off ones too (module `platforms`). */
  platforms: Schemas['Platform'][];
  /** Active vehicles. */
  vehicles: Schemas['Vehicle'][];
  /** Read the data again; a step calls it after saving. */
  reload: () => Promise<void>;
}

export interface StepProps {
  ctx: OnboardingCtx;
  /** Go to the next step; call after the answer is saved. */
  next: () => void;
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
  Component: ComponentType<StepProps>;
}

/** The steps, in order. A new step is one entry here. */
export const STEPS: Step[] = [
  {
    id: 'region',
    title: 'Where you drive',
    visible: (c) => (c.country?.regions.length ?? 0) > 0,
    done: (c) => c.settings.region !== null,
    Component: RegionStep,
  },
  {
    id: 'work',
    title: 'What work you do',
    visible: (c) => (c.country?.work.length ?? 0) > 1,
    done: (c) => c.settings.work_kinds.length > 0,
    Component: WorkStep,
  },
  {
    id: 'apps',
    title: 'Your apps',
    visible: (c) => c.settings.modules.platforms,
    done: appsAnswered,
    Component: AppsStep,
  },
  {
    id: 'vehicle',
    title: 'Your vehicle',
    visible: () => true,
    done: (c) => c.vehicles.length > 0,
    Component: VehicleStep,
  },
];
