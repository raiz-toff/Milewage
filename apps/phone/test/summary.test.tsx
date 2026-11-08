import { countryModules, mileageDeduction } from '@milewage/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { money } from '../src/screens/HomeSummary';
import { runningValue, summarize, weekStart } from '../src/store/summary';
import { FakePermissions } from '../src/permissions/fake';
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
    const us = countryModules.get('US')!;
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
      mileageDeduction(us, { totalM: m, priorM: 0, date: '2025-10-15', vehicleKind: 'car' })!;
    expect(s.week.deductionCents).toBe(each(16_000) + each(8_000));
    expect(s.month.deductionCents).toBe(each(10_000) + each(16_000) + each(8_000));
  });

  it("Canada's tier is shared across shifts of the year, and no pack means no value, not zero", () => {
    const s = summarize([row('2025-03-01', 4_900_000), row('2025-03-02', 200_000)], {
      today: '2025-03-02',
      country: 'CA',
      vehicleKinds: none,
    });
    const ca = countryModules.get('CA')!;
    expect(s.month.deductionCents).toBe(
      mileageDeduction(ca, {
        totalM: 4_900_000,
        priorM: 0,
        date: '2025-03-01',
        vehicleKind: 'car',
      })! +
        mileageDeduction(ca, {
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

  it("the server's value wins for a shift it has sent, including none (actual expenses)", () => {
    const us = countryModules.get('US')!;
    const local = (m: number) =>
      mileageDeduction(us, { totalM: m, priorM: 0, date: '2025-10-15', vehicleKind: 'car' })!;
    const s = summarize(
      [
        row('2025-10-13', 8_000, { server_deduction_cents: 123, server_deduction_known: 1 }),
        // A vehicle deducted through actual expenses: the server says none, so none is counted.
        row('2025-10-14', 8_000, { server_deduction_cents: null, server_deduction_known: 1 }),
        row('2025-10-15', 8_000, { sync_state: 'local' }), // not sent yet: the phone's estimate
      ],
      { today: '2025-10-15', country: 'US', vehicleKinds: none },
    );
    expect(s.week.deductionCents).toBe(123 + local(8_000));
  });

  it("the driver's own rate only where the country has no rates, and never for a bicycle", () => {
    const ownRate = { centsPerUnit: 30.5, unit: 'km' as const };
    const rows = [row('2025-03-01', 12_500), row('2025-03-01', 5_000, { vehicle_id: 2 })];
    const kinds = new Map([[2, 'bicycle']]);
    const opts = { today: '2025-03-02', vehicleKinds: kinds, ownRate };
    expect(summarize(rows, { ...opts, country: 'ZZ' }).month.deductionCents).toBe(381);
    // Canada has official rates: the own rate is ignored.
    expect(summarize(rows, { ...opts, country: 'CA' }).month.deductionCents).toBe(
      summarize(rows, { ...opts, country: 'CA', ownRate: null }).month.deductionCents,
    );
  });

  it('the running shift is priced after the shifts before it (a shared tier), and not at all without a rate', () => {
    const before = [row('2025-03-01', 4_900_000), row('2025-03-02', 99_000, { status: 'active' })];
    const shift = { totalM: 200_000, date: '2025-03-02', startedAt: 1, vehicleId: 1 };
    const ca = countryModules.get('CA')!;
    expect(runningValue(before, { country: 'CA', vehicleKinds: none }, shift)).toBe(
      mileageDeduction(ca, {
        totalM: 200_000,
        priorM: 4_900_000,
        date: '2025-03-02',
        vehicleKind: 'car',
      }),
    );
    expect(runningValue(before, { country: 'ZZ', vehicleKinds: none }, shift)).toBeNull();
  });

  it('the running shift shows its deduction value so far', async () => {
    const { services, tracker } = setup(server(), {
      paired: {
        country: 'ZZ',
        mileage_rate: 'yours',
        own_mileage_rate: { cents_per_unit: 100, unit: 'km' },
      },
      permissions: new FakePermissions({ foregroundLocation: 'granted' }),
      refreshMs: 20,
    });
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Start shift' }));
    expect(await screen.findByText('Shift running')).toBeTruthy();
    drive(tracker); // about 0.45 km at 1.00 a km
    await waitFor(() =>
      expect(
        screen.getByLabelText('Deduction so far (your rate)').props.accessibilityValue.text,
      ).toBe('$0.45'),
    );
  });

  it("money uses the currency's own digits, also without Intl", () => {
    expect(money(1234, 'USD')).toBe('$12.34');
    expect(money(1234, 'JPY')).toBe('¥1,234');
    expect(money(1234, 'KWD')).toMatch(/KWD\s1\.234/);
    const real = Intl.NumberFormat;
    Intl.NumberFormat = (() => {
      throw new RangeError('no Intl');
    }) as unknown as typeof Intl.NumberFormat;
    try {
      expect([money(1234, 'JPY'), money(1234, 'KWD'), money(1234, 'CAD')]).toEqual([
        '1234 JPY',
        '1.234 KWD',
        '12.34 CAD',
      ]);
    } finally {
      Intl.NumberFormat = real;
    }
  });

  it("labels a value at the driver's own rate as theirs on the home screen", async () => {
    const { services } = setup(server(), {
      paired: {
        country: 'ZZ',
        mileage_rate: 'yours',
        own_mileage_rate: { cents_per_unit: 30, unit: 'km' },
      },
    });
    render(<App services={services} />);
    expect(await screen.findByLabelText(/^Deduction value \(your rate\) /)).toBeTruthy();
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
    expect((await screen.findByLabelText('Distance this week')).props.children).toMatch(/ mi$/);
    expect(screen.getByLabelText(/^Deduction value \$/)).toBeTruthy();
    expect(screen.getByText('This week includes 1 shift not yet on the server.')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'This month' }));
    expect(screen.getByLabelText('Distance this month')).toBeTruthy();
    expect(screen.getByText('This month includes 1 shift not yet on the server.')).toBeTruthy();
  });
});
