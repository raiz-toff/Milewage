import { afterEach, expect, test } from 'vitest';
import { connect, mcpHarness, resultOf } from './mcp-support';
import type { Harness } from './support';

let h: Harness;
afterEach(() => h.close());

test('each read tool answers exactly what its REST route answers', async () => {
  const m = await mcpHarness();
  h = m.h;
  const shift = await m.web('POST', '/shifts', {
    client_id: '00000000-0000-4000-8000-000000000001',
    vehicle_id: 1,
    started_at: h.clock.t - 3_600_000,
  });
  const id = shift.json().id as number;
  const category = (await m.web('GET', '/expenses/categories')).json()[0].slug as string;
  const spent = { spent_on: '2027-01-10', category, amount_cents: 5420, merchant: 'Esso' };
  expect((await m.web('POST', '/expenses', spent)).statusCode).toBe(201);
  const goal = { label: 'Week', metric: 'earnings', period: 'weekly', target: 50_000 };
  expect((await m.web('POST', '/goals', goal)).statusCode).toBe(201);
  const reading = { vehicle_id: 1, kind: 'year_start', reading_m: 12_345_000, recorded_at: 1 };
  expect((await m.web('POST', '/odometer', reading)).statusCode).toBe(201);

  const client = await connect(h, m.read.token);
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toEqual([
    'get_profile',
    'get_summary',
    'list_shifts',
    'get_shift',
    'get_analytics',
    'list_expenses',
    'get_expense_totals',
    'list_goals',
    'get_tax_estimate',
    'list_odometer_readings',
  ]);

  const same: [string, object, string][] = [
    ['list_shifts', { status: 'active' }, '/shifts?status=active&limit=20'],
    [
      'get_analytics',
      { from: '2027-01-01', to: '2027-01-31', group: 'trends' },
      '/analytics?from=2027-01-01&to=2027-01-31&group=trends',
    ],
    ['list_expenses', { from: '2027-01-01' }, '/expenses?from=2027-01-01&limit=50'],
    ['get_expense_totals', { year: 2027 }, '/expenses/totals?year=2027'],
    ['list_goals', {}, '/goals'],
    ['get_tax_estimate', { year: 2027 }, '/tax/2027'],
    ['list_odometer_readings', { kind: 'year_start' }, '/odometer?kind=year_start'],
  ];
  for (const [name, args, path] of same) {
    const rest = await m.web('GET', path);
    const tool = await client.callTool({ name, arguments: args as Record<string, unknown> });
    if (rest.statusCode >= 400) {
      expect(tool.isError, name).toBe(true);
    } else {
      expect(tool.isError, name).toBeFalsy();
      expect(resultOf(tool), name).toEqual(rest.json());
    }
  }
  const expenses = resultOf(await client.callTool({ name: 'list_expenses', arguments: {} }));
  expect(expenses).toMatchObject({ items: [{ merchant: 'Esso', amount_cents: 5420 }] });

  const one = await client.callTool({ name: 'get_shift', arguments: { shift: id } });
  expect(resultOf(one)).toEqual({
    shift: (await m.web('GET', `/shifts/${id}`)).json(),
    trips: [],
    earnings: (await m.web('GET', `/shifts/${id}/earnings`)).json(),
  });
  const missing = await client.callTool({ name: 'get_shift', arguments: { shift: 999 } });
  expect(missing.isError).toBe(true);
  expect(JSON.stringify(missing.content)).toMatch(/not found/i);
});

test('tools of modules that are off are not offered', async () => {
  const m = await mcpHarness({
    analytics: false,
    expenses: false,
    receipts: false,
    import: false,
    goals: false,
    tax: false,
    earnings: false,
  });
  h = m.h;
  const client = await connect(h, m.read.token);
  expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
    'get_profile',
    'get_summary',
    'list_shifts',
    'get_shift',
    'list_odometer_readings',
  ]);
  const profile = resultOf(await client.callTool({ name: 'get_profile', arguments: {} }));
  expect(profile).toMatchObject({ expense_categories: null });
});
