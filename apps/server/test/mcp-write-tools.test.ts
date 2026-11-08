import { afterEach, expect, test } from 'vitest';
import { connect, mcpHarness, resultOf } from './mcp-support';
import type { Harness } from './support';

let h: Harness;
afterEach(() => h.close());

const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const audit = () =>
  h.db.prepare('SELECT token_id, tool, outcome, target, args FROM mcp_audit ORDER BY id').all() as {
    token_id: number;
    tool: string;
    outcome: string;
    target: string | null;
    args: string;
  }[];

test('a read token neither sees nor can call a write tool', async () => {
  const m = await mcpHarness();
  h = m.h;
  const reader = await connect(h, m.read.token);
  const names = (await reader.listTools()).tools.map((t) => t.name);
  expect(names).not.toContain('add_expense');
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: {
      authorization: `Bearer ${m.read.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_expense', arguments: {} },
    },
  });
  expect(res.statusCode).toBe(403);
  expect(res.headers['www-authenticate']).toBe('Bearer error="insufficient_scope", scope="write"');
  expect(audit()).toEqual([]);

  const writer = await connect(h, m.write.token);
  const tools = (await writer.listTools()).tools;
  const add = tools.find((t) => t.name === 'add_expense')!;
  expect(add.annotations).toMatchObject({
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  });
  expect(tools.find((t) => t.name === 'update_expense')!.annotations).toMatchObject({
    destructiveHint: true,
  });
});

test('add and change an expense through the REST rules, with an audit row each', async () => {
  const m = await mcpHarness();
  h = m.h;
  const client = await connect(h, m.write.token);
  const category = (await m.web('GET', '/expenses/categories')).json()[0].slug as string;
  const added = await client.callTool({
    name: 'add_expense',
    arguments: { spent_on: '2027-01-14', category, amount_cents: 5420, merchant: 'Esso' },
  });
  expect(added.isError).toBeFalsy();
  const e = resultOf(added) as { id: number };
  expect(textOf(added)).toBe(
    `Added expense #${e.id}: ${category} $54.20 on 2027-01-14 at Esso. To undo, open it in MileWage on the web and delete or edit it.`,
  );
  expect(e).toEqual((await m.web('GET', `/expenses/${e.id}`)).json());

  const changed = await client.callTool({
    name: 'update_expense',
    arguments: { id: e.id, amount_cents: 5000 },
  });
  expect(textOf(changed)).toContain(
    `from ${category} $54.20 on 2027-01-14 at Esso to ${category} $50.00`,
  );
  expect((await m.web('GET', `/expenses/${e.id}`)).json().amount_cents).toBe(5000);

  // The REST checks apply: an unknown category and a vehicle that is not yours.
  const bad = await client.callTool({
    name: 'add_expense',
    arguments: { spent_on: '2027-01-14', category: 'nope', amount_cents: 1, vehicle_id: 9 },
  });
  expect(bad.isError).toBe(true);
  expect(textOf(bad)).toContain('/category is not an expense category');
  expect(textOf(bad)).toContain('/vehicle_id is not one of your vehicles');

  const rows = audit();
  expect(rows.map((r) => [r.token_id, r.tool, r.target])).toEqual([
    [m.write.id, 'add_expense', `expense:${e.id}`],
    [m.write.id, 'update_expense', `expense:${e.id}`],
    [m.write.id, 'add_expense', null],
  ]);
  expect(rows.map((r) => r.outcome)).toEqual(['ok', 'ok', 'error: Validation failed']);
  expect(JSON.parse(rows[1]!.args)).toMatchObject({
    arguments: { id: e.id, amount_cents: 5000 },
    before: { amount_cents: 5420 },
  });
});

test('earnings lines keep their sign rule; at most 30 changes a minute per token', async () => {
  const m = await mcpHarness();
  h = m.h;
  const shift = await m.web('POST', '/shifts', {
    client_id: '00000000-0000-4000-8000-000000000001',
    vehicle_id: 1,
    started_at: h.clock.t - 3_600_000,
  });
  const ref = shift.json().id as number;
  const ended = await m.web('POST', `/shifts/${ref}/end`, { ended_at: h.clock.t - 60_000 });
  expect(ended.statusCode).toBe(200);
  const platform = (await m.web('GET', '/platforms')).json()[0].slug as string;
  const client = await connect(h, m.write.token);
  const tip = await client.callTool({
    name: 'add_earning_entry',
    arguments: { shift: ref, platform, type: 'tip', amount_cents: 600 },
  });
  expect(tip.isError).toBeFalsy();
  expect(textOf(tip)).toContain(`Added tip $6.00 for ${platform} to shift #${ref}.`);
  const earnings = (await m.web('GET', `/shifts/${ref}/earnings`)).json();
  expect(JSON.stringify(earnings)).toContain('"amount_cents":600');
  const wrongSign = await client.callTool({
    name: 'add_earning_entry',
    arguments: { shift: ref, platform, type: 'platform_fee', amount_cents: 300 },
  });
  expect(wrongSign.isError).toBe(true);

  for (let i = 0; i < 28; i++) {
    await client.callTool({
      name: 'add_earning_entry',
      arguments: { shift: ref, platform, type: 'tip', amount_cents: 1 },
    });
  }
  const over = await client.callTool({
    name: 'add_earning_entry',
    arguments: { shift: ref, platform, type: 'tip', amount_cents: 1 },
  });
  expect(over.isError).toBe(true);
  expect(textOf(over)).toMatch(/at most 30 changes a minute/);
  h.clock.t += 60_000;
  const later = await client.callTool({
    name: 'add_earning_entry',
    arguments: { shift: ref, platform, type: 'tip', amount_cents: 1 },
  });
  expect(later.isError).toBeFalsy();
}, 30_000); // 32 tool calls, each a few in-process requests
