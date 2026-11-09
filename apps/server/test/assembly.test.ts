import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  assembleServer,
  loadConfig,
  openAndMigrate,
  serverModules,
  type App,
  type Db,
} from '../src/index';
import { harness, TRACKING_OFF, type Harness } from './support';

// The server is assembled in one place (`assembleServer`); production and the test harness both
// call it. These tests read what it builds: the route table, and the facts that reach the modules.

/** The route table recorded before the assembly was rewritten, with the module that owns each route. */
const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/route-table.json', import.meta.url), 'utf8'),
) as Record<string, string>;

const names = serverModules.map((m) => m.name);
const toggleable = serverModules.filter((m) => m.toggleable !== false).map((m) => m.name);
/** The module and every module that needs it, directly or not. */
const withDependents = (name: string): Set<string> => {
  const out = new Set([name]);
  for (let grew = true; grew;) {
    grew = false;
    for (const m of serverModules) {
      if (!out.has(m.name) && m.dependsOn.some((d) => out.has(d))) {
        out.add(m.name);
        grew = true;
      }
    }
  }
  return out;
};

let dir: string;
let db: Db;
afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * Assembles a server as production does: `settings.json` (here every module on, the ones that are
 * off by default too) and the environment's `MILEWAGE_MODULE_<NAME>=0` for the modules in `off`.
 * Returns its route table as "METHOD /path" keys.
 */
async function routeTable(off: ReadonlySet<string> = new Set()) {
  dir = mkdtempSync(join(tmpdir(), 'mw-assembly-'));
  db = openAndMigrate(join(dir, 'milewage.db'));
  const config = loadConfig({
    MILEWAGE_DATA_DIR: dir,
    MILEWAGE_CONFIG_DIR: join(dir, 'config'),
    MILEWAGE_BACKUP_DIR: join(dir, 'backups'),
    MILEWAGE_LOG_LEVEL: 'silent',
  });
  const env = Object.fromEntries(
    [...off].map((name) => [`MILEWAGE_MODULE_${name.toUpperCase()}`, '0']),
  );
  const app: App = assembleServer({
    db,
    config: { ...config, settings: { modules: Object.fromEntries(names.map((n) => [n, true])) } },
    env,
  });
  const table = new Set<string>();
  app.fastify.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) if (method !== 'HEAD') table.add(`${method} ${r.url}`);
  });
  await app.fastify.ready();
  return { app, table };
}

describe('the assembled server', () => {
  test('with every module on it serves the same routes as before the assembly was rewritten', async () => {
    const { app, table } = await routeTable();
    expect([...table].sort()).toEqual(Object.keys(recorded).sort());
    await app.fastify.close();
  });

  test.each(toggleable)(
    'with %s off, its routes (and its dependents) are gone and every other route is served',
    async (name) => {
      const off = withDependents(name);
      const { app, table } = await routeTable(off);
      const expected = Object.entries(recorded)
        .filter(([, owner]) => !off.has(owner))
        .map(([route]) => route);
      expect([...table].sort()).toEqual(expected.sort());
      // A route of a module that is off is a plain 404, like any unknown path.
      const own = Object.entries(recorded).find(([, owner]) => owner === name);
      if (own) {
        const [method, url] = own[0].split(' ') as [string, string];
        const res = await app.fastify.inject({ method: method as 'GET', url });
        expect([res.statusCode, res.json().code], own[0]).toEqual([404, 'not_found']);
      }
      expect(app.registry.isEnabled(name)).toBe(false);
      await app.fastify.close();
    },
  );
});

describe('facts reach the modules that are on, whatever else is off', () => {
  let h: Harness;
  afterEach(() => h?.close());

  test('tracking off: a failed backup lands in the inbox and in diagnostics', async () => {
    h = harness(TRACKING_OFF);
    const { cookie } = await h.signUp();
    // A file where the backup folder should be: the run cannot write its copy.
    writeFileSync(join(h.dir, 'backups'), 'not a folder');
    const run = await h.call('POST', '/backups', undefined, { cookie });
    expect(run.statusCode).toBeGreaterThanOrEqual(500);

    const inbox = (await h.call('GET', '/notifications', undefined, { cookie })).json();
    expect(inbox.items.map((n: { kind: string }) => n.kind)).toContain('backup_failed');
    const events = (
      await h.call('GET', '/diagnostics/events?kind=backup.run&src=server', undefined, { cookie })
    ).json();
    expect(events.items).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ trigger: 'manual', ok: false }) }),
    ]);
  });

  test('a module that is off hears nothing: notifications off, a failed backup adds no inbox row', async () => {
    h = harness({ notifications: false });
    const { cookie } = await h.signUp();
    writeFileSync(join(h.dir, 'backups'), 'not a folder');
    await h.call('POST', '/backups', undefined, { cookie });
    expect(h.db.prepare('SELECT count(*) FROM notifications').pluck().get()).toBe(0);
    // The other listener still hears it.
    const events = (
      await h.call('GET', '/diagnostics/events?kind=backup.run&src=server', undefined, { cookie })
    ).json();
    expect(events.items).toHaveLength(1);
  });
});
