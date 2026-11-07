/**
 * Where the install guide lives. Assumption (owner to confirm): it is published at this address;
 * this is the only place to change it.
 */
export const INSTALL_GUIDE_URL = 'https://milewage.dev/install';

/** The four steps of 24 section 4.2 screen 2, shown on the phone and sent to a computer. */
export const SERVER_STEPS = [
  {
    title: 'Install MileWage',
    detail: 'On a computer that stays on, such as a home PC or a small server. Follow the guide.',
  },
  {
    title: 'Turn on Tailscale',
    detail: 'It lets this phone reach your server from anywhere, safely. The guide shows how.',
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

/** The text the share sheet sends: the steps and the guide, readable in any app. */
export const shareStepsMessage = () =>
  [
    'Set up your MileWage server:',
    ...SERVER_STEPS.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`),
    `Install guide: ${INSTALL_GUIDE_URL}`,
  ].join('\n');
