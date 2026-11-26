import type { ModuleJob } from '@milewage/shared';
import type { Db } from './db';

/** The public repository the update check asks, and the pages its answer points to. */
export const REPO = 'raiz-toff/Milewage';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const SITE = `https://github.com/${REPO}/`;

const DAY = 24 * 60 * 60 * 1000;
/** After a start the first check waits this long, so a restart loop never calls GitHub. */
const START_DELAY_MS = 60_000;
/** While the switch is off the job looks again this often, to notice it being switched on. */
const OFF_POLL_MS = 60 * 60 * 1000;

interface Parsed {
  core: [number, number, number];
  pre: string[];
}

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A semantic version, with or without a leading "v"; null when it is not one. */
export function parseVersion(text: string): Parsed | null {
  const m = SEMVER.exec(text.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

const NUMERIC = /^\d+$/;

/** Semver 2.0 section 11 precedence; a build suffix (+...) does not count. */
function comparePre(a: string[], b: string[]): -1 | 0 | 1 {
  // A version without a pre-release is newer than the same version with one.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = NUMERIC.test(x);
    const yn = NUMERIC.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1; // numbers sort before words
    return x < y ? -1 : 1;
  }
  return 0;
}

/** -1, 0 or 1 like a sort comparator, or null when either side is not a semantic version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x.core[i]! !== y.core[i]!) return x.core[i]! < y.core[i]! ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}

/** The newest published release: its version without a "v", and the page that describes it. */
export interface Release {
  version: string;
  url: string;
}
/** Asks where releases are published. Tests pass their own; nothing else may touch the network. */
export type UpdateFetcher = (signal: AbortSignal) => Promise<Release>;

/**
 * The real fetcher: one anonymous GET of the public releases API. It sends no cookie, no
 * identifier and nothing about this server or its owner; GitHub sees an IP address and a generic
 * client name, as with any request.
 */
export const fetchLatestRelease: UpdateFetcher = async (signal) => {
  const res = await fetch(RELEASES_API, {
    signal,
    redirect: 'error',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'milewage-update-check' },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
  const url = typeof body.html_url === 'string' ? body.html_url : '';
  const parsed = parseVersion(tag);
  if (!parsed) throw new Error('GitHub sent a release without a version');
  if (!url.startsWith(SITE)) throw new Error('GitHub sent an unexpected release address');
  return { version: tag.trim().replace(/^v/, ''), url };
};

/** What the last check found, as stored. */
export interface UpdateState {
  attemptedAt: number;
  succeededAt: number | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  error: string | null;
}

/** What the screens need: the state and the pages to open. */
export interface UpdateInfo {
  checkedAt: number | null;
  latestVersion: string | null;
  available: boolean;
  releaseUrl: string | null;
  /** "What's new": the release page of the newer version, else the running version's changelog. */
  notesUrl: string;
  error: string | null;
}

export interface UpdateServiceOptions {
  db: Db;
  now: () => number;
  /** The running version. */
  current: string;
  /** Absent in a server that must not call out (tests): every check then fails, quietly. */
  fetchLatest?: UpdateFetcher;
  timeoutMs?: number;
}

export function createUpdateService(o: UpdateServiceOptions) {
  const read = o.db.prepare(
    `SELECT attempted_at AS attemptedAt, succeeded_at AS succeededAt, latest_version AS latestVersion,
            release_url AS releaseUrl, error FROM update_check WHERE id = 1`,
  );
  const write = o.db.prepare(
    `INSERT INTO update_check (id, attempted_at, succeeded_at, latest_version, release_url, error)
     VALUES (1, @attemptedAt, @succeededAt, @latestVersion, @releaseUrl, @error)
     ON CONFLICT(id) DO UPDATE SET attempted_at = @attemptedAt, succeeded_at = @succeededAt,
       latest_version = @latestVersion, release_url = @releaseUrl, error = @error`,
  );
  const state = () => read.get() as UpdateState | undefined;
  let running: Promise<void> | undefined;

  async function attempt(): Promise<void> {
    const before = state();
    const at = o.now();
    try {
      if (!o.fetchLatest) throw new Error('Update checks are not set up on this server');
      const release = await o.fetchLatest(AbortSignal.timeout(o.timeoutMs ?? 10_000));
      write.run({
        attemptedAt: at,
        succeededAt: at,
        latestVersion: release.version,
        releaseUrl: release.url,
        error: null,
      });
    } catch (e) {
      // Silent: nothing is logged or shown but on the Health page. The last good answer stays.
      write.run({
        attemptedAt: at,
        succeededAt: before?.succeededAt ?? null,
        latestVersion: before?.latestVersion ?? null,
        releaseUrl: before?.releaseUrl ?? null,
        error: (e instanceof Error ? e.message : 'The check failed').slice(0, 200),
      });
    }
  }

  return {
    state,
    /** Asks now. Never throws; two calls at once share one request. */
    check(): Promise<void> {
      running ??= attempt().finally(() => {
        running = undefined;
      });
      return running;
    },
    info(): UpdateInfo {
      const s = state();
      const newer = s?.latestVersion != null && compareVersions(s.latestVersion, o.current) === 1;
      return {
        checkedAt: s?.succeededAt ?? null,
        latestVersion: s?.latestVersion ?? null,
        available: newer,
        releaseUrl: s?.releaseUrl ?? null,
        notesUrl: newer && s?.releaseUrl ? s.releaseUrl : `${SITE}blob/v${o.current}/CHANGELOG.md`,
        error: s?.error ?? null,
      };
    },
  };
}
export type UpdateService = ReturnType<typeof createUpdateService>;

/** How long to wait before the next automatic check: a day after the last attempt, never sooner. */
export function nextCheckDelay(now: number, attemptedAt: number | undefined, enabled: boolean) {
  if (!enabled) return OFF_POLL_MS;
  return Math.max(0, (attemptedAt ?? -Infinity) + DAY - now);
}

/** Checks at most once a day, in the background, while the owner's switch is on. */
export function updateCheckJob(o: {
  service: UpdateService;
  enabled: () => boolean;
  now: () => number;
  startDelayMs?: number;
}): ModuleJob {
  return {
    name: 'update-check',
    start() {
      let timer: NodeJS.Timeout | undefined;
      const arm = (minimum: number) => {
        const wait = nextCheckDelay(o.now(), o.service.state()?.attemptedAt, o.enabled());
        timer = setTimeout(
          () => {
            const due =
              o.enabled() && nextCheckDelay(o.now(), o.service.state()?.attemptedAt, true) === 0;
            void (due ? o.service.check() : Promise.resolve()).then(() => arm(0));
          },
          Math.max(wait, minimum),
        );
        timer.unref();
      };
      arm(o.startDelayMs ?? START_DELAY_MS);
      return () => clearTimeout(timer);
    },
  };
}
