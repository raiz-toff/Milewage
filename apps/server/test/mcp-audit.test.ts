import { afterEach, expect, test } from 'vitest';
import { AUDIT_KEPT_MS, createAuditPrune } from '../src/mcp/audit';
import { mcpHarness } from './mcp-support';
import { harness, type Harness } from './support';

let h: Harness;
afterEach(() => h.close());

const DAY = 24 * 3600_000;
const insert = (tokenId: number, at: number) =>
  h.db
    .prepare(
      "INSERT INTO mcp_audit (user_id, token_id, at, tool, outcome, target, args) VALUES (1, ?, ?, 'add_expense', 'ok', 'expense:1', '{}')",
    )
    .run(tokenId, at);
const ats = () => h.db.prepare('SELECT at FROM mcp_audit ORDER BY at').pluck().all();

test('audit rows older than a year go, newer rows stay', async () => {
  const m = await mcpHarness();
  h = m.h;
  const old = h.clock.t - AUDIT_KEPT_MS - 1;
  const kept = h.clock.t - AUDIT_KEPT_MS + DAY;
  insert(m.write.id, old);
  insert(m.write.id, kept);
  insert(m.write.id, h.clock.t);
  expect(createAuditPrune(h.db, () => h.clock.t).prune()).toBe(1);
  expect(ats()).toEqual([kept, h.clock.t]);
});

test('the retention job runs on its interval inside the server', async () => {
  h = harness({ mcp: true }, { mcpHousekeepingMs: 30 });
  const { cookie } = await h.signUp();
  const res = await h.call('POST', '/mcp/tokens', { name: 'w', scope: 'write' }, { cookie });
  const { id } = res.json() as { id: number };
  insert(id, h.clock.t - AUDIT_KEPT_MS - DAY);
  insert(id, h.clock.t);
  await new Promise((r) => setTimeout(r, 120));
  expect(ats()).toEqual([h.clock.t]);
});

test('a missing audit table is logged, not thrown', async () => {
  // Read-only mode after a skipped upgrade: the server starts on the old schema.
  h = harness();
  h.db.exec('DROP TABLE mcp_audit');
  const logged: string[] = [];
  const { job } = createAuditPrune(
    h.db,
    () => h.clock.t,
    30,
    (m) => logged.push(m),
  );
  const stop = job.start();
  await new Promise((r) => setTimeout(r, 50));
  stop();
  expect(logged[0]).toBe('mcp audit prune failed');
});
