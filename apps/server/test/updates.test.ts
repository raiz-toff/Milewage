import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  compareVersions,
  createUpdateService,
  nextCheckDelay,
  openAndMigrate,
  parseVersion,
  updateCheckJob,
  type UpdateFetcher,
} from '../src/index';

/** A real file: the server's database refuses to run without WAL, which `:memory:` cannot do. */
function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-updates-'));
  const db = openAndMigrate(join(dir, 'milewage.db'));
  return {
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const page = (v: string) => `https://github.com/raiz-toff/Milewage/releases/tag/v${v}`;

describe('version comparison', () => {
  test('orders by major, minor and patch as numbers', () => {
    expect(compareVersions('0.3.2', '0.3.1')).toBe(1);
    expect(compareVersions('0.3.1', '0.3.2')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1); // not alphabetical
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  test('equal versions, with or without a leading v or a build suffix', () => {
    expect(compareVersions('0.3.1', '0.3.1')).toBe(0);
    expect(compareVersions('v0.3.1', '0.3.1')).toBe(0);
    expect(compareVersions('0.3.1+abc', '0.3.1+def')).toBe(0);
  });

  test('a pre-release ranks below its release and pre-releases follow semver 11', () => {
    expect(compareVersions('0.4.0-rc.1', '0.4.0')).toBe(-1);
    expect(compareVersions('0.4.0', '0.4.0-rc.1')).toBe(1);
    expect(compareVersions('0.4.0-rc.1', '0.3.9')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.beta', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.11')).toBe(1);
  });

  test('anything that is not a semantic version has no order', () => {
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v', '1.2.x', '1.2.3-', '01.2.3 beta']) {
      expect(parseVersion(bad), bad).toBeNull();
      expect(compareVersions(bad, '1.0.0'), bad).toBeNull();
      expect(compareVersions('1.0.0', bad), bad).toBeNull();
    }
  });
});

describe('update service', () => {
  let tmp: ReturnType<typeof tempDb>;
  beforeEach(() => {
    tmp = tempDb();
  });
  afterEach(() => tmp.close());

  const service = (fetchLatest: UpdateFetcher | undefined, t: { now: number }) =>
    createUpdateService({ db: tmp.db, now: () => t.now, current: '0.3.1', fetchLatest });
  const release = (version: string): UpdateFetcher =>
    vi.fn(async () => ({ version, url: page(version) }));

  test("a newer release is available and What's new is its page", async () => {
    const s = service(release('0.4.0'), { now: 1000 });
    await s.check();
    expect(s.info()).toMatchObject({
      available: true,
      latestVersion: '0.4.0',
      checkedAt: 1000,
      error: null,
      notesUrl: page('0.4.0'),
    });
  });

  test('the same or an older release is not an update; notes point at the running changelog', async () => {
    for (const v of ['0.3.1', '0.3.0']) {
      const s = service(release(v), { now: 1 });
      await s.check();
      expect(s.info().available).toBe(false);
      expect(s.info().notesUrl).toBe(
        'https://github.com/raiz-toff/Milewage/blob/v0.3.1/CHANGELOG.md',
      );
    }
  });

  test('a failure is recorded quietly and keeps the last good answer', async () => {
    const t = { now: 1000 };
    let fail = false;
    const s = service(async () => {
      if (fail) throw new Error('getaddrinfo ENOTFOUND api.github.com');
      return { version: '0.4.0', url: page('0.4.0') };
    }, t);
    await s.check();
    fail = true;
    t.now = 2000;
    await expect(s.check()).resolves.toBeUndefined();
    expect(s.state()).toMatchObject({
      attemptedAt: 2000,
      succeededAt: 1000,
      latestVersion: '0.4.0',
    });
    expect(s.info()).toMatchObject({
      available: true,
      error: 'getaddrinfo ENOTFOUND api.github.com',
    });
  });

  test('a server with no fetcher never calls out and says so', async () => {
    const s = service(undefined, { now: 5 });
    await s.check();
    expect(s.info().error).toMatch(/not set up/);
  });

  test('a malformed latest version is never "newer"', async () => {
    const s = service(release('nightly'), { now: 1 });
    await s.check();
    expect(s.info().available).toBe(false);
  });

  test('two checks at once make one request', async () => {
    const fetch = release('0.4.0');
    const s = service(fetch, { now: 1 });
    await Promise.all([s.check(), s.check()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('daily schedule', () => {
  test('the next check is a day after the last attempt, never sooner', () => {
    expect(nextCheckDelay(1000, undefined, true)).toBe(0);
    expect(nextCheckDelay(1000, 1000, true)).toBe(DAY);
    expect(nextCheckDelay(1000 + DAY / 2, 1000, true)).toBe(DAY / 2);
    expect(nextCheckDelay(1000 + DAY, 1000, true)).toBe(0);
    expect(nextCheckDelay(1000 + 3 * DAY, 1000, true)).toBe(0);
  });

  test('while switched off it only looks again later and never asks', () => {
    expect(nextCheckDelay(1000, undefined, false)).toBe(60 * 60 * 1000);
  });

  describe('the job', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function setup(enabled: { on: boolean }) {
      const tmp = tempDb();
      const fetch = vi.fn(async () => ({ version: '0.4.0', url: page('0.4.0') }));
      const now = () => Date.now();
      const service = createUpdateService({
        db: tmp.db,
        now,
        current: '0.3.1',
        fetchLatest: fetch,
      });
      const stop = updateCheckJob({ service, enabled: () => enabled.on, now }).start();
      return {
        fetch,
        stop: () => {
          stop();
          tmp.close();
        },
      };
    }

    test('asks once a minute after the start, then once a day', async () => {
      const j = setup({ on: true });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(j.fetch).toHaveBeenCalledTimes(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(j.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DAY - 10_000);
      expect(j.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(j.fetch).toHaveBeenCalledTimes(2);
      j.stop();
    });

    test('never asks while switched off, and asks soon after it is switched on', async () => {
      const enabled = { on: false };
      const j = setup(enabled);
      await vi.advanceTimersByTimeAsync(3 * DAY);
      expect(j.fetch).not.toHaveBeenCalled();
      enabled.on = true;
      await vi.advanceTimersByTimeAsync(61 * 60 * 1000);
      expect(j.fetch).toHaveBeenCalledTimes(1);
      j.stop();
    });

    test('stopping the job stops the asking', async () => {
      const j = setup({ on: true });
      j.stop();
      await vi.advanceTimersByTimeAsync(2 * DAY);
      expect(j.fetch).not.toHaveBeenCalled();
    });
  });
});
