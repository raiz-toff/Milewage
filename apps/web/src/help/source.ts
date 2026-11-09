import { version } from '../../package.json';

/** Where the project lives. A test keeps it equal to the address in README.md. */
export const SOURCE_URL = 'https://github.com/raiz-toff/Milewage';

/**
 * The version these pages describe: the web build's own (`apps/web/package.json`, kept equal to
 * `VERSION` by `npm run version:check`), so the pages always match the bundle they ship in.
 */
export const HELP_VERSION: string = version;

/** A repository file on GitHub, at the tag of `v` (the running version by default). */
export const githubUrl = (repoPath: string, v: string = HELP_VERSION) =>
  `${SOURCE_URL}/blob/v${v}/${repoPath}`;
