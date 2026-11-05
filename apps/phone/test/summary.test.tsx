import { countryPacks } from '@milewage/shared';
import { render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { summarize, weekStart } from '../src/store/summary';
import { drive, server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const row = (local_date: string, total_m: number | null, over: Record<string, unknown> = {}) => ({
  local_date,
  started_at: Date.parse(`${local_date}T12:00:00Z`),
  status: 'ended' as const,
  total_m,
  vehicle_id: 1,
  sync_state: 'on_server' as const,
  ...over,
});
const none = new Map<number, string>();

describe('home summary', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2025-10-15')).toBe('2025-10-13'); // Wednesday
    expect(weekStart('2025-10-13')).toBe('2025-10-13');
    expect(weekStart('2025-10-19')).toBe('2025-10-13'); // Sunday
  });

  it('sums week and month from the shifts on the phone, with the pack value, and counts unsynced shifts', () => {
    const us = countryPacks.get('US')!;
    const s = summarize(
      [
        row('2025-10-02', 10_000), // this month, not this week
        row('2025-10-14', 16_000, { sync_state: 'local' }),
        row('2025-10-15', 8_000),
        row('2025-10-15', 99_000, { status: 'active' }), // running: not counted
        row('2025-10-16', null), // no totals yet: not counted
        row('2025-09-30', 5_000), // last month
      ],
      { today: '2025-10-15', country: 'US', vehicleKinds: none },
    );
    expect(s.week).toMatchObject({ from: '2025-10-13', shifts: 2, unsynced: 1, totalM: 24_000 });
    expect(s.month).toMatchObject({ from: '2025-10-01', shifts: 3, totalM: 34_000 });
    const each = (m: number) =>
      us.deduction({ totalM: m, priorM: 0, date: '2025-10-15', vehicleKind: 'car' })!;
    expect(s.week.deductionCents).toBe(each(16_000) + each(8_000));
    expect(s.month.deductionCents).toBe(each(10_000) + each(16_000) + each(8_000));
  });

  it("Canada's tier is shared across shifts of the year, and no pack means no value, not zero", () => {
    const s = summarize([row('2025-03-01', 4_900_000), row('2025-03-02', 200_000)], {
      today: '2025-03-02',
      country: 'CA',
      vehicleKinds: none,
    });
    const ca = countryPacks.get('CA')!;
    expect(s.month.deductionCents).toBe(
      ca.deduction({ totalM: 4_900_000, priorM: 0, date: '2025-03-01', vehicleKind: 'car' })! +
        ca.deduction({
          totalM: 200_000,
          priorM: 4_900_000,
          date: '2025-03-02',
          vehicleKind: 'car',
        })!,
    );
    const nowhere = summarize([row('2025-03-01', 1000)], {
      today: '2025-03-02',
      country: 'ZZ',
      vehicleKinds: none,
    });
    expect(nowhere.month).toMatchObject({ totalM: 1000, deductionCents: null });
  });

  it('shows on the home screen from local data alone, including a shift not yet sent', async () => {
    const down = server({ 'POST /shifts': () => new Response('{}', { status: 503 }) });
    const { services, tracker, clock } = setup(down);
    clock.t = Date.now();
    await services.shift.start({ vehicleId: 3 });
    drive(tracker, clock.t);
    clock.t += 100_000;
    await services.shift.end();
    render(<App services={services} />);
    expect(await screen.findByText(/This week: .* mi · deduction value \$/)).toBeTruthy();
    expect(screen.getAllByText(/includes 1 shift not yet on the server/).length).toBe(2);
  });
});
