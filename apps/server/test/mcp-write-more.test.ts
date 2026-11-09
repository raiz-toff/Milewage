import { afterEach, expect, test } from 'vitest';
import { localInstant } from '../src/time';
import { connect, mcpHarness, resultOf } from './mcp-support';
import type { Harness } from './support';

let h: Harness | undefined;
afterEach(() => h?.close());
const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

test('shift notes, odometer readings in miles and a hand-made trip, each audited', async () => {
  const m = await mcpHarness();
  h = m.h;
  const started = h.clock.t - 3 * 3_600_000;
  const shift = await m.web('POST', '/shifts', {
    client_id: '00000000-0000-4000-8000-000000000001',
    vehicle_id: 1,
    started_at: started,
  });
  const ref = shift.json().id as number;
  await m.web('POST', `/shifts/${ref}/end`, { ended_at: h.clock.t - 60_000 });
  const client = await connect(h, m.write.token);

  const notes = await client.callTool({
    name: 'update_shift',
    arguments: { shift: ref, notes: 'Rain all evening' },
  });
  expect(notes.isError).toBeFalsy();
  expect(resultOf(notes)).toMatchObject({
    before: { notes: null },
    after: { notes: 'Rain all evening' },
  });
  expect((await m.web('GET', `/shifts/${ref}`)).json().notes).toBe('Rain all evening');

  // The owner reads miles in America/Chicago (UTC-6 in January).
  const odo = await client.callTool({
    name: 'record_odometer',
    arguments: { kind: 'year_start', reading: 12_345.6, at: '2027-01-01T08:00', vehicle_id: 1 },
  });
  expect(odo.isError).toBeFalsy();
  expect(resultOf(odo)).toMatchObject({
    kind: 'year_start',
    reading_m: Math.round(12_345.6 * 1609.344),
    recorded_at: Date.UTC(2027, 0, 1, 14, 0),
  });
  expect(textOf(odo)).toBe('Recorded year start odometer 12345.6 mi at 2027-01-01T08:00.');
  const noShift = await client.callTool({
    name: 'record_odometer',
    arguments: { kind: 'shift_end', reading: 1, at: '2027-01-01T08:00' },
  });
  expect(noShift.isError).toBe(true);

  // The clock is 2027-01-15T02:00 in Chicago; the shift ran from 23:00 to 01:59.
  const startLocal = '2027-01-14T23:30';
  const trip = await client.callTool({
    name: 'add_trip',
    arguments: {
      shift: ref,
      kind: 'active',
      started_at: startLocal,
      ended_at: '2027-01-14T23:50',
      distance: 4.2,
      purpose: 'DoorDash order',
    },
  });
  expect(trip.isError, textOf(trip)).toBeFalsy();
  const trips = (await m.web('GET', `/shifts/${ref}/trips`)).json() as {
    distance_m: number;
    started_at: number;
    purpose: string;
  }[];
  expect(trips).toEqual([
    expect.objectContaining({
      distance_m: Math.round(4.2 * 1609.344),
      started_at: localInstant('2027-01-14', 23 * 60 + 30, 'America/Chicago'),
      purpose: 'DoorDash order',
    }),
  ]);
  const future = await client.callTool({
    name: 'add_trip',
    arguments: {
      shift: ref,
      kind: 'active',
      started_at: '2030-01-01T10:00',
      ended_at: '2030-01-01T11:00',
      distance: 1,
      purpose: 'x',
    },
  });
  expect(future.isError).toBe(true); // the REST rule: not in the future

  const rows = h.db.prepare('SELECT tool, outcome, target FROM mcp_audit ORDER BY id').all();
  expect(rows).toEqual([
    { tool: 'update_shift', outcome: 'ok', target: `shift:${ref}` },
    { tool: 'record_odometer', outcome: 'ok', target: expect.stringMatching(/^odometer:\d+$/) },
    { tool: 'record_odometer', outcome: 'error: Refused', target: null },
    { tool: 'add_trip', outcome: 'ok', target: `shift:${ref}` },
    { tool: 'add_trip', outcome: 'error: Validation failed', target: null },
  ]);
  const audit = (await m.web('GET', '/mcp/audit')).json();
  expect(audit[0]).toMatchObject({
    tool: 'add_trip',
    token_name: 'write',
    outcome: 'error: Validation failed',
  });
  expect(audit[0]).not.toHaveProperty('args');
  expect(audit).toHaveLength(5);
});
