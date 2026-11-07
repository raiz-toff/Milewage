import { shiftNotice } from '../src/shift/notice';
import { makeServices } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

const ZONE = 'America/Toronto';
const AT = Date.UTC(2026, 10, 7, 14, 2); // 09:02 in Toronto on 2026-11-07

describe('running-shift notification', () => {
  it("counts only today's ended shifts, never the running one", () => {
    const n = shiftNotice({
      clientId: 'run',
      startedAt: AT,
      vehicle: 'Civic',
      unit: 'km',
      timeZone: ZONE,
      rows: [
        { client_id: 'a', local_date: '2026-11-07', status: 'ended', total_m: 12_000 },
        { client_id: 'b', local_date: '2026-11-07', status: 'finalized', total_m: 3_500 },
        { client_id: 'c', local_date: '2026-11-06', status: 'ended', total_m: 99_000 }, // yesterday
        { client_id: 'd', local_date: '2026-11-07', status: 'ended', total_m: null }, // no total yet
        { client_id: 'run', local_date: '2026-11-07', status: 'active', total_m: null },
      ],
    });
    expect(n).toEqual({
      startedAt: AT,
      unit: 'km',
      earlierM: 15_500,
      earlierShifts: 2,
      footer: 'Started 09:02 · Civic',
    });
  });

  it('leaves the vehicle out when its name is not known', () => {
    const n = shiftNotice({
      clientId: 'run',
      startedAt: AT,
      vehicle: null,
      unit: 'mi',
      timeZone: ZONE,
      rows: [],
    });
    expect(n.footer).toBe('Started 09:02');
    expect(n.earlierShifts).toBe(0);
  });

  it('is set when a shift starts, cleared when it ends, and set again after a restart', async () => {
    const { services, tracker, plain, clock } = setup();
    const notice = () => tracker.notice; // read fresh: the tracker changes it
    await services.shift.vehicles(); // keeps the vehicle names for the footer
    await services.shift.start({ vehicleId: 3 });
    expect(tracker.notice).toMatchObject({
      startedAt: 1_000,
      unit: 'mi',
      earlierM: 0,
      earlierShifts: 0,
    });
    expect(tracker.notice?.footer).toMatch(/^Started \d\d:\d\d · Civic$/);

    // New process with the shift still running: the notification gets its details again.
    tracker.notice = null;
    const again = makeServices(server().fetch, { paired: true, tracker, now: () => clock.t });
    again.plain.data.set('shift.active', plain.data.get('shift.active')!);
    await again.services.shift.load();
    expect(again.services.shift.current?.clientId).toBe(ID);
    expect(notice()?.startedAt).toBe(1_000);

    await again.services.shift.end();
    expect(notice()).toBeNull();
  });

  it('is not set when the server has the tracking module off', async () => {
    const off = setup(undefined, { paired: { modules: { tracking: false } } });
    await off.services.shift.start({ vehicleId: 3 });
    expect(off.tracker.notice).toBeNull();
  });
});
