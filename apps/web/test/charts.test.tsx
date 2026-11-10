// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BarChart,
  ChartFigure,
  Heatmap,
  LineChart,
  SegmentBar,
  bands,
  binOf,
  labelStep,
  linePath,
  percent,
  stackMax,
  stackRows,
  topRoundedRect,
  valueAxis,
} from '../src/ui/charts';
import { Comparison } from '../src/ui/Comparison';
import { comparedWith, slotNames } from '../src/series';
import { formatDistanceTick, formatMoneyTick, hourLabel } from '../src/format';
import './support/kit'; // jsdom's missing ResizeObserver

afterEach(cleanup);

describe('chart maths', () => {
  it('a value axis is zero-based with d3 nice numbers', () => {
    expect(valueAxis(147.1)).toEqual({ max: 150, ticks: [0, 50, 100, 150] });
    expect(valueAxis(9375, 4)).toEqual({ max: 10_000, ticks: [0, 2000, 4000, 6000, 8000, 10_000] });
    expect(valueAxis(0.37, 4).max).toBe(0.4);
    expect(valueAxis(0)).toEqual({ max: 1, ticks: [0] });
    expect(valueAxis(Number.NaN)).toEqual({ max: 1, ticks: [0] });
  });

  it('bands cap the bar at 24 px and find the slot under a point', () => {
    const b = bands(7, 40, 700);
    expect(b.step).toBe(100);
    expect(b.bar).toBe(24);
    expect(b.x(0)).toBe(40 + 38);
    expect(b.center(1)).toBe(190);
    expect([b.at(39), b.at(40), b.at(739), b.at(740)]).toEqual([null, 0, 6, null]);
    expect(bands(31, 0, 310).bar).toBe(8); // a 10 px slot less the 2 px gap
  });

  it('axis labels thin out to a friendly step when they would collide', () => {
    expect(labelStep(7, 600, 3)).toBe(1);
    expect(labelStep(31, 300, 2)).toBe(3);
    expect(labelStep(12, 200, 3)).toBe(2);
  });

  it('stacks rows of series, nulls as zero, negatives below the line', () => {
    const rows = [
      [10, 5],
      [null, 3],
      [4, -2],
    ];
    expect(stackRows(rows, 2)).toEqual([
      [
        [0, 10],
        [0, 0],
        [0, 4],
      ],
      [
        [10, 15],
        [0, 3],
        [-2, 0],
      ],
    ]);
    expect(stackMax(rows)).toBe(15);
    expect(stackMax([])).toBe(0);
  });

  it('a line breaks at a null and a bar rounds only its data end', () => {
    expect(linePath([{ x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 3, y: 3 }])).toBe('M0,0L1,1M3,3Z');
    const d = topRoundedRect(0, 10, 20, 50, 4);
    expect(d.startsWith('M0,60V14Q0,10 4,10H16Q20,10 20,14V60Z')).toBe(true);
    expect(topRoundedRect(0, 0, 0, 10)).toBe('');
    expect(topRoundedRect(0, 0, 10, 2)).toContain('V2'); // the radius shrinks to the height
  });

  it('bins and shares', () => {
    expect([0, 1, 19, 20, 99, 100, 150].map((v) => binOf(v, 100))).toEqual([0, 0, 0, 1, 4, 4, 4]);
    expect(binOf(5, 0)).toBe(0);
    expect([percent(1, 3), percent(2, 3), percent(1, 0)]).toEqual([33, 67, 0]);
  });
});

describe('periods compared and slot names', () => {
  it('compares a running period with the last up to the same point', () => {
    const t = '2026-11-10'; // a Tuesday
    expect(comparedWith('week', { from: '2026-11-09', to: t }, t)).toEqual({
      current: { from: '2026-11-09', to: t },
      previous: { from: '2026-11-02', to: '2026-11-03' },
      words: 'by this point last week',
    });
    expect(comparedWith('month', { from: '2026-03-01', to: '2026-03-31' }, t).previous).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(comparedWith('month', { from: '2026-11-01', to: t }, t).previous).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
    });
    expect(
      comparedWith('year', { from: '2028-01-01', to: '2028-02-29' }, '2028-02-29').previous,
    ).toEqual({
      from: '2027-01-01',
      to: '2027-02-28',
    });
    expect(comparedWith('today', { from: t, to: t }, t)).toMatchObject({
      previous: { from: '2026-11-09', to: '2026-11-09' },
      words: 'yesterday',
    });
    expect(comparedWith('30d', { from: '2026-10-12', to: t }, t)).toMatchObject({
      previous: { from: '2026-09-12', to: '2026-10-11' },
      words: 'the 30 days before',
    });
    // A week that is over is compared whole with the week before.
    expect(comparedWith('week', { from: '2026-10-26', to: '2026-11-01' }, t)).toMatchObject({
      current: { from: '2026-10-26', to: '2026-11-01' },
      previous: { from: '2026-10-19', to: '2026-10-25' },
      words: 'the week before',
    });
  });

  it('names a slot: weekday for a week, day of month for longer, month for a year', () => {
    expect(slotNames('2026-11-10', 'day', 7)).toEqual({ tick: 'Tue', name: 'Tue, Nov 10' });
    expect(slotNames('2026-11-10', 'day', 30).tick).toBe('10');
    expect(slotNames('2026-11-01', 'month', 12)).toEqual({ tick: 'Nov', name: 'November 2026' });
  });

  it('axis formats come from the app’s formatters', () => {
    expect(formatMoneyTick(50, 'USD')).toBe('US$50');
    expect(formatMoneyTick(2.5, 'USD')).toBe('US$2.50');
    expect(formatMoneyTick(12_000, 'CAD')).toBe('$12K');
    expect(formatDistanceTick(12.25, 'km')).toBe('12.3 km');
    expect([hourLabel(0, '12h'), hourLabel(13, '12h'), hourLabel(9, '24h')]).toEqual([
      '12 AM',
      '1 PM',
      '09:00',
    ]);
  });
});

const slots = [
  { key: 'a', tick: 'Mon', name: 'Mon, Nov 9', values: [60, 10], note: '1 shift' },
  { key: 'b', tick: 'Tue', name: 'Tue, Nov 10', values: [null, null], note: '1 shift' },
  { key: 'c', tick: 'Wed', name: 'Wed, Nov 11', values: [null, null], future: true },
  { key: 'd', tick: 'Thu', name: 'Thu, Nov 12', values: [20, 0], note: '2 shifts' },
];
const series = [
  { key: 'pay', label: 'Pay', color: 'red' },
  { key: 'tips', label: 'Tips', color: 'blue' },
];
const fmt = (v: number) => `$${v}`;

describe('chart rendering', () => {
  it('a bar chart is one keyboard stop; the arrows walk the slots, skipping the future', () => {
    render(
      <BarChart label="Earned each day" series={series} slots={slots} format={fmt} unit="day" />,
    );
    const chart = screen.getByRole('group', { name: /^Earned each day\. Use the arrow keys/ });
    expect(chart.getAttribute('tabindex')).toBe('0');
    expect(chart.getAttribute('aria-roledescription')).toBe('chart');
    // Drawn: two stacked parts on Monday, one on Thursday, nothing for the null and future days.
    expect(
      [...chart.querySelectorAll('path[data-slot]')].map((p) => p.getAttribute('data-slot')),
    ).toEqual(['a', 'a', 'd']);
    // The tallest slot carries the one direct label.
    expect(within(chart).getAllByText('$70')).toHaveLength(1);
    fireEvent.focus(chart);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('$70Mon, Nov 9$60Pay$10Tips1 shift');
    expect(chart.querySelector('[aria-live]')!.textContent).toBe(
      'Mon, Nov 9, $70, Pay $60, Tips $10, 1 shift',
    );
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByRole('tooltip').textContent).toBe('Not enteredTue, Nov 101 shift');
    fireEvent.keyDown(chart, { key: 'ArrowRight' }); // Wednesday is still to come: skipped
    expect(screen.getByRole('tooltip').textContent).toContain('Thu, Nov 12');
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(screen.getByRole('tooltip').textContent).toContain('Mon, Nov 9');
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.keyDown(chart, { key: 'End' });
    fireEvent.blur(chart);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('emphasis draws one slot in its colour and the rest in chart-other, and labels it', () => {
    render(
      <BarChart
        label="Today"
        series={[series[0]!]}
        slots={[
          { key: 'x', tick: 'Mon', name: 'Mon', values: [90] },
          { key: 'y', tick: 'Tue', name: 'Tue', values: [30] },
        ]}
        format={fmt}
        emphasis={1}
      />,
    );
    const fills = [...document.querySelectorAll<SVGPathElement>('path[data-slot]')].map(
      (p) => p.style.fill,
    );
    expect(fills).toEqual(['var(--md-extended-color-chart-other)', 'red']);
    expect(screen.getByText('$30')).toBeTruthy();
    expect(screen.queryByText('$90')).toBeNull();
  });

  it('the figure keeps a table for screen readers and shows it on request', () => {
    render(
      <ChartFigure
        label="Earned each day"
        legend={[
          { label: 'Pay', color: 'red' },
          { label: 'Tips', color: 'blue' },
        ]}
        table={{
          columns: [{ label: 'Day' }, { label: 'Earned', numeric: true }],
          rows: [{ key: 'a', head: 'Mon, Nov 9', cells: ['$70.00'] }],
        }}
      >
        <p>plot</p>
      </ChartFigure>,
    );
    const figure = screen.getByRole('figure', { name: 'Earned each day' });
    const table = within(figure).getByRole('table', { name: 'Earned each day' });
    expect(table.parentElement!.className).toBe('sr-only');
    expect(within(table).getByRole('row', { name: 'Mon, Nov 9 $70.00' })).toBeTruthy();
    expect(within(figure).getByText('Pay')).toBeTruthy(); // the legend for two series
    const toggle = within(figure).getByRole('button', { name: 'Show as a table' });
    fireEvent.click(toggle);
    expect(table.parentElement!.className).not.toMatch(/sr-only/);
    expect(
      within(figure).getByRole('button', { name: 'Hide table' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('dots alone for a rate: one marker per slot with a figure, never a line', () => {
    render(
      <LineChart
        label="Per hour"
        dots
        slots={['a', 'b', 'c'].map((k) => ({ key: k, tick: k, name: k }))}
        series={[{ key: 'r', label: 'Per hour', color: 'green', values: [20, null, 25] }]}
        format={fmt}
        reference={{ value: 22, label: '$22' }}
      />,
    );
    const chart = screen.getByRole('group', { name: /^Per hour/ });
    expect(chart.querySelectorAll('circle')).toHaveLength(2);
    expect(chart.querySelectorAll('path')).toHaveLength(0);
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowRight' }); // b has no figure: skipped
    expect(screen.getByRole('tooltip').textContent).toBe('$25c');
  });

  it('a heatmap moves across and down with the arrows and names the cell', () => {
    const cell = (v: number | null, t: string) => ({ value: v, tip: { title: t } });
    render(
      <Heatmap
        label="Pay per hour"
        rows={['Mon', 'Tue']}
        cols={['6 AM', '9 AM']}
        cells={[
          [cell(10, 'Mon 6'), cell(null, 'Mon 9')],
          [cell(30, 'Tue 6'), cell(5, 'Tue 9')],
        ]}
        color="green"
        format={fmt}
      />,
    );
    const grid = screen.getByRole('group', { name: /^Pay per hour/ });
    fireEvent.focus(grid);
    expect(screen.getByRole('tooltip').textContent).toBe('Mon 6');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' }); // stays at the edge
    expect(screen.getByRole('tooltip').textContent).toBe('Tue 9');
    // Cells with nothing are the muted fill; the others a step of the colour.
    expect(grid.querySelector('[data-cell="0-1"]')!.className).toMatch(/bg-surface-container-low/);
    expect((grid.querySelector('[data-cell="1-0"]') as HTMLElement).style.background).toContain(
      'green 100%',
    );
    expect(screen.getByText('Under $6')).toBeTruthy();
  });

  it('a split names every part in its accessible name and lists only parts with distance', () => {
    render(
      <SegmentBar
        label="Distance by kind"
        parts={[
          { key: 'a', label: 'Active', value: 30, color: 'x', figure: '3.0 mi' },
          { key: 'd', label: 'Deadhead', value: 10, color: 'y', figure: '1.0 mi' },
          { key: 'p', label: 'Personal', value: 0, color: 'z', figure: '0.0 mi' },
        ]}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Distance by kind: Active 3.0 mi, 75%; Deadhead 1.0 mi, 25%',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Personal')).toBeNull();
  });

  it('a comparison says the direction in words, not only with the arrow', () => {
    const words = (current: number | null, previous: number | null) => {
      cleanup();
      render(<Comparison current={current} previous={previous} format={fmt} words="last week" />);
      return screen.queryByTestId('comparison')?.textContent ?? null;
    };
    expect(words(150, 100)).toBe('$50 (50%) more than last week ($100)');
    expect(words(80, 100)).toBe('$20 (20%) less than last week ($100)');
    expect(words(100, 100)).toBe('The same as last week ($100)');
    expect(words(100, 0)).toBe('Nothing earned last week.');
    expect(words(null, 100)).toBeNull();
    expect(words(0, 0)).toBeNull();
  });
});
