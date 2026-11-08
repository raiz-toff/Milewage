/**
 * Where the install guide lives, or null while there is none. Assumption removed (X2): the owner
 * has not chosen a public address for the guide, so the app shows the written steps only and hides
 * "Open the guide". This is the only place to set it.
 */
export const INSTALL_GUIDE_URL: string | null = null;

/** The four steps of 24 section 4.2 screen 2, shown on the phone and sent to a computer. */
export const SERVER_STEPS = [
  {
    title: 'Install MileWage',
    detail: 'On a computer that stays on, such as a home PC or a small server.',
  },
  {
    title: 'Turn on Tailscale',
    detail: 'It lets this phone reach your server from anywhere, safely.',
  },
  {
    title: 'Create your account',
    detail: 'Open MileWage in the browser on that computer and create your account.',
  },
  {
    title: 'Pair a phone',
    detail: 'Finish the setup steps, then press Pair a phone. A code appears for this phone.',
  },
] as const;

/** The text the share sheet sends: the steps, and the guide when there is one. */
export const shareStepsMessage = (guide: string | null = INSTALL_GUIDE_URL) =>
  [
    'Set up your MileWage server:',
    ...SERVER_STEPS.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`),
    ...(guide ? [`Install guide: ${guide}`] : []),
  ].join('\n');
