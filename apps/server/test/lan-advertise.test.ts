import { expect, test } from 'vitest';
import {
  checkHealth,
  createAdvertiser,
  serviceName,
  txtRecord,
  type Announced,
} from '../src/lan/advertise';

function fakeAnnouncer() {
  const events: string[] = [];
  const created: { name: string; type: string; port: number; txt: Record<string, string> }[] = [];
  return {
    events,
    created,
    announcer: {
      createService(o: (typeof created)[number]): Announced {
        created.push(o);
        return {
          advertise: async () => void events.push(`advertise ${JSON.stringify(o.txt)}`),
          updateTxt: (txt) => void events.push(`txt ${JSON.stringify(txt)}`),
          end: async () => void events.push('end'),
          destroy: async () => void events.push('destroy'),
        };
      },
      shutdown: async () => void events.push('shutdown'),
    },
  };
}

test('announces _milewage._tcp while the server answers, follows its id, withdraws when it stops', async () => {
  const f = fakeAnnouncer();
  let health = { ok: false, instanceId: null as string | null };
  const a = createAdvertiser({
    name: 'MileWage (box)',
    port: 8080,
    check: async () => health,
    announcer: f.announcer,
  });
  await a.tick();
  expect([a.announced, f.events]).toEqual([false, []]); // nothing until the server answers

  health = { ok: true, instanceId: null }; // up, owner not created yet
  await a.tick();
  expect(f.created).toEqual([
    { name: 'MileWage (box)', type: 'milewage', port: 8080, txt: { v: '1', path: '/' } },
  ]);
  health = { ok: true, instanceId: 'inst-1' };
  await a.tick();
  await a.tick(); // unchanged: nothing sent
  health = { ok: false, instanceId: null };
  await a.tick();
  expect(a.announced).toBe(false);
  health = { ok: true, instanceId: 'inst-1' };
  await a.tick();
  await a.stop();
  expect(f.events).toEqual([
    'advertise {"v":"1","path":"/"}',
    'txt {"v":"1","id":"inst-1","path":"/"}',
    'end',
    'destroy',
    'advertise {"v":"1","id":"inst-1","path":"/"}',
    'end',
    'shutdown',
  ]);
});

test('the record holds only the version, the instance id and the path; names fit one label', () => {
  expect(txtRecord('abc')).toEqual({ v: '1', id: 'abc', path: '/' });
  expect(serviceName('milewage-box.lan')).toBe('MileWage (milewage-box)');
  expect(serviceName('')).toBe('MileWage (server)');
  expect(serviceName('x'.repeat(80))).toBe('MileWage');
});

test('health: ok with the instance header; an error or a timeout is not ok', async () => {
  const ok = await checkHealth(
    'http://box/healthz',
    async () => new Response('{"ok":true}', { headers: { 'X-MileWage-Instance': 'inst-9' } }),
  );
  expect(ok).toEqual({ ok: true, instanceId: 'inst-9' });
  expect(
    await checkHealth('http://box/healthz', async () => new Response('', { status: 503 })),
  ).toEqual({
    ok: false,
    instanceId: null,
  });
  expect(
    await checkHealth('http://box/healthz', async () => {
      throw new TypeError('fetch failed');
    }),
  ).toEqual({ ok: false, instanceId: null });
});
