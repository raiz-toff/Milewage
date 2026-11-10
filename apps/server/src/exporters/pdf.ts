import PDFDocument from 'pdfkit';
import {
  builtinPlatform,
  countryName,
  expenseCategory,
  paperSize,
  UNIT_METRES,
  type PaperSize,
} from '@milewage/shared';
import {
  createExpenseRepository,
  createProcessingRepository,
  totalOf,
  type EffectiveRow,
  type ExpenseRow,
  type ShiftRow,
} from '../db';
import { ProblemError } from '../errors';
import { deductibleCents } from '../expense-math';
import type { PeriodRate, RateUsed, ValuedShift } from '../mileage-deduction';
import { periodRate } from '../mileage-deduction';
import { SERVER_VERSION } from '../version';
import { createOdometerChecks } from './odometer';
import { ROBOTO_BOLD, ROBOTO_REGULAR } from './pdf-fonts';
import type { ExportContext, Exporter } from './registry';
import { NOT_ADVICE } from './reports';

// The mileage and expenses report for an accountant (DECISIONS.md, 2026-11-10): one PDF for a period, built from
// the same figures as the CSV files and the tax summary. Nothing here is a tax rule; the numbers
// come from the mileage deduction, the expense maths and the earnings policy.

const DAY = 86_400_000;
const REGULAR = Buffer.from(ROBOTO_REGULAR, 'base64');
const BOLD = Buffer.from(ROBOTO_BOLD, 'base64');

/** Short words for the shift flags an accountant should see (the shift page has the long ones). */
const FLAG_WORDS: Readonly<Record<string, string>> = {
  gap_counted: 'distance estimated across a signal gap',
  gap_large: 'long signal gap, distance may be missing',
  gap_dropped: 'signal gap not counted',
  tracking_interrupted: 'tracking interrupted',
  shift_auto_closed: 'ended automatically',
  manual_trip_present: 'includes a trip added by hand',
  imported: 'imported from a file, not tracked',
  calc_mismatch: 'phone and server figures differ',
};

/** One shift's line in the log. */
interface LogRow {
  shift: ShiftRow;
  businessM: number;
  personalM: number;
  deduction: ValuedShift;
  platforms: string[];
  odometer: { startM: number | null; endM: number | null; check: string };
  flags: string[];
}

/** Everything the report says, worked out before a page is drawn. Tests read the totals from here too. */
export interface ReportModel {
  title: string;
  paper: PaperSize;
  from: string;
  to: string;
  driverName: string | null;
  vehicles: string[];
  /** The vehicle filter, if one was chosen. */
  vehicleOnly: string | null;
  /** Every vehicle's name by id, archived ones too. */
  vehicleNames: ReadonlyMap<number, string>;
  country: string;
  generatedAt: number;
  version: string;
  notices: string[];
  shifts: number;
  totalM: number;
  businessM: number;
  personalM: number;
  mileageCents: number | null;
  mileageRate: PeriodRate;
  rates: RateUsed[];
  /** Vehicles deducted through their actual expenses in a year of the period: no mileage value. */
  actualExpenses: string[];
  /** Null when the expenses module is off. */
  expenses: {
    byCategory: {
      category: string;
      count: number;
      spentCents: number;
      deductibleCents: number;
      coveredCents: number;
    }[];
    spentCents: number;
    deductibleCents: number;
    coveredCents: number;
    rows: ExpenseRow[];
    /** Expenses the mileage rate already pays for (double-counted): saved, not deducted. */
    covered: ReadonlySet<number>;
  } | null;
  /** Null when the earnings module is off; `totalCents` null when nothing was entered or labelled. */
  earnings: {
    totalCents: number | null;
    grossCents: number;
    tipsCents: number;
    bonusCents: number;
    feesCents: number;
  } | null;
  log: LogRow[];
}

const calendar = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d) ? t : undefined;
};
const bad = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

/** The period: from and to, or a year (calendar, as the tax summary counts it), default this year. */
function periodOf(c: ExportContext): { from: string; to: string } {
  const { from, to, year } = c.query;
  if (from || to) {
    if (!from || !to) throw bad('/from', 'give both from and to');
    const a = calendar(from);
    const b = calendar(to);
    if (a === undefined) throw bad('/from', 'is not a calendar date');
    if (b === undefined) throw bad('/to', 'is not a calendar date');
    if (b < a) throw bad('/from', 'must not be after to');
    if ((b - a) / DAY > 365) throw bad('/to', 'at most 366 days after from');
    return { from, to };
  }
  const y = year ?? Number(c.driver.today().slice(0, 4));
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

const platformLabel = (slug: string) => builtinPlatform(slug)?.label ?? slug;

/** Gathers the report's figures from the same sources as the CSV files and the tax summary. */
export function reportModel(c: ExportContext): ReportModel {
  const { from, to } = periodOf(c);
  const vehicleId = c.query.vehicle_id;
  const shifts = createProcessingRepository(c.db)
    .shiftsInPeriod(c.userId, from, to)
    .filter((s) => vehicleId === undefined || s.vehicleId === vehicleId);
  const values = c.deduction.valued(shifts);
  const odometer = createOdometerChecks(c.db, c.userId, c.driver.timeZone);
  const flagRows = createProcessingRepository(c.db).flagsOf(shifts.map((s) => s.id));
  const earningsOn = c.enabled('earnings');
  // With a vehicle chosen, only the earnings of its shifts.
  const ids = new Set(shifts.map((s) => s.id));
  const earned = earningsOn
    ? c.readers
        .earningsBetween(from, to)
        .filter((r) => vehicleId === undefined || ids.has(r.shiftId))
    : [];
  const earnedBy = new Map<number, EffectiveRow[]>();
  for (const r of earned) earnedBy.set(r.shiftId, [...(earnedBy.get(r.shiftId) ?? []), r]);

  const log: LogRow[] = shifts.map((s, i) => {
    const total = s.totalM ?? 0;
    const personal = Math.min(total, s.personalM ?? 0);
    const labels = c.driver.stopsOn ? c.readers.labels(s.id) : [];
    const platforms = [
      ...new Set(
        [...labels.map((l) => l.platform), ...(earnedBy.get(s.id) ?? []).map((r) => r.platform)]
          .filter((p): p is string => !!p)
          .map(platformLabel),
      ),
    ];
    const odo = odometer.shift(s);
    const flags = (flagRows.get(s.id) ?? [])
      .map((f) => FLAG_WORDS[f.code])
      .filter((w): w is string => !!w);
    if (odo.check.startsWith('mismatch') || odo.check.startsWith('invalid'))
      flags.push(`odometer ${odo.check}`);
    return {
      shift: s,
      businessM: total - personal,
      personalM: personal,
      deduction: values[i]!,
      platforms,
      odometer: odo,
      flags: [...new Set(flags)],
    };
  });

  const sum = (f: (r: LogRow) => number) => log.reduce((a, r) => a + f(r), 0);
  const priced = values.filter((v) => v.cents !== null);
  const vehicleIds = [...new Set(shifts.map((s) => s.vehicleId))];
  const years = [...new Set([from.slice(0, 4), to.slice(0, 4)].map(Number))];
  const actualExpenses = [...c.vehicles.values()]
    .filter((v) => vehicleId === undefined || v.id === vehicleId)
    .filter((v) => years.some((y) => c.deduction.method(c.userId, v.id, y) === 'actual_expenses'))
    .map((v) => v.name);

  let expenses: ReportModel['expenses'] = null;
  if (c.enabled('expenses')) {
    const rows = createExpenseRepository(c.db)
      .between(c.userId, from, to)
      .filter((e) => vehicleId === undefined || e.vehicleId === vehicleId);
    const by = new Map<string, NonNullable<ReportModel['expenses']>['byCategory'][number]>();
    const covered = new Set<number>();
    for (const e of rows) {
      const t = by.get(e.category) ?? {
        category: e.category,
        count: 0,
        spentCents: 0,
        deductibleCents: 0,
        coveredCents: 0,
      };
      const double = c.deduction.doubleCounts(c.userId, e);
      if (double) covered.add(e.id);
      t.count += 1;
      t.spentCents += e.amountCents;
      if (double) t.coveredCents += deductibleCents(e);
      else t.deductibleCents += deductibleCents(e);
      by.set(e.category, t);
    }
    const cats = [...by.values()].sort((a, b) => b.spentCents - a.spentCents);
    const total = (f: (x: (typeof cats)[number]) => number) => cats.reduce((a, x) => a + f(x), 0);
    expenses = {
      byCategory: cats,
      spentCents: total((x) => x.spentCents),
      deductibleCents: total((x) => x.deductibleCents),
      coveredCents: total((x) => x.coveredCents),
      rows,
      covered,
    };
  }

  const rate = periodRate(values);
  const pack = c.driver.pack;
  const notices = [
    ...(pack && !pack.verified
      ? [
          `Unverified rates: MileWage's figures for ${countryName(c.driver.country)} have not yet been checked against the official publications.`,
        ]
      : []),
    ...(rate === 'yours' || rate === 'mixed'
      ? ['Your mileage rate is a figure you entered. It is not an official rate.']
      : []),
    NOT_ADVICE,
  ];
  const sumEarned = (f: (r: EffectiveRow) => number) => earned.reduce((a, r) => a + f(r), 0);
  return {
    title: 'Mileage and expenses report',
    paper: c.query.paper ?? paperSize(c.driver.country),
    from,
    to,
    driverName: c.driver.settings.displayName,
    vehicles: vehicleIds.map((id) => c.vehicles.get(id)?.name ?? `Vehicle ${id}`),
    vehicleOnly: vehicleId === undefined ? null : (c.vehicles.get(vehicleId)?.name ?? null),
    vehicleNames: new Map([...c.vehicles.values()].map((v) => [v.id, v.name])),
    country: c.driver.country,
    generatedAt: c.now(),
    version: SERVER_VERSION,
    notices,
    shifts: shifts.length,
    totalM: sum((r) => r.businessM + r.personalM),
    businessM: sum((r) => r.businessM),
    personalM: sum((r) => r.personalM),
    mileageCents: priced.length ? priced.reduce((a, v) => a + v.cents!, 0) : null,
    mileageRate: rate,
    rates: c.deduction.ratesUsed(shifts),
    actualExpenses,
    expenses,
    earnings: earningsOn
      ? {
          totalCents: earned.length ? sumEarned(totalOf) : null,
          grossCents: sumEarned((r) => r.grossCents),
          tipsCents: sumEarned((r) => r.tipsCents),
          bonusCents: sumEarned((r) => r.bonusCents),
          feesCents: sumEarned((r) => r.feesCents),
        }
      : null,
    log,
  };
}

/** The formats every figure in the report goes through: the driver's currency, unit, zone and clock. */
export function reportFormats(c: Pick<ExportContext, 'driver'>) {
  const { currency, unit, timeZone, country } = c.driver;
  const hour12 = c.driver.settings.timeFormat === '12h';
  // As the web app: currency in en-CA with the currency's own minor digits (JPY 0, USD 2, KWD 3).
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en-CA', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // not a currency Intl knows
  }
  const currencyFormat = (extra: number) => {
    try {
      return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency,
        maximumFractionDigits: digits + extra,
      });
    } catch {
      return new Intl.NumberFormat('en-CA', { maximumFractionDigits: digits + extra });
    }
  };
  const moneyFormat = currencyFormat(0);
  const rateFormat = currencyFormat(2);
  let locale = 'en-CA';
  try {
    locale = Intl.DateTimeFormat.supportedLocalesOf(`en-${country}`)[0] ?? 'en-CA';
  } catch {
    // keep en-CA
  }
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const timeFormat = new Intl.DateTimeFormat('en-CA', { timeZone, timeStyle: 'short', hour12 });
  const stampFormat = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12,
  });
  const number = new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const whole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
  const scale = 10 ** digits;
  return {
    unit,
    money: (minor: number | null) =>
      minor === null ? 'not available' : moneyFormat.format(minor / scale),
    /** A per-distance rate in minor units with hundredths: "$0.725 per mi". */
    rate: (minor: number, per: 'km' | 'mi') => `${rateFormat.format(minor / scale)} per ${per}`,
    distance: (m: number) => `${number.format(m / UNIT_METRES[unit])} ${unit}`,
    odometer: (m: number) => whole.format(Math.round(m / UNIT_METRES[unit])),
    day: (iso: string) => dayFormat.format(Date.parse(`${iso}T00:00:00Z`)),
    time: (ms: number) => timeFormat.format(ms),
    stamp: (ms: number) => stampFormat.format(ms),
  };
}

const PAPER: Record<PaperSize, string> = { a4: 'A4', letter: 'LETTER' };
const MARGIN = 42;
const FOOTER = 28;
const INK = '#1d1b16';
const MUTED = '#5f5c52';
const RULE = '#c9c5b9';
const FILL = '#f2efe4';

type Cell = string | { text: string; sub?: string };
interface Column {
  label: string;
  /** Share of the content width. */
  share: number;
  align?: 'left' | 'right';
}

/**
 * Draws the report. Every piece of text is tagged (headings, paragraphs, tables with header cells)
 * and rules, fills and page numbers are artifacts, so a screen reader gets the content in order.
 */
export function renderReport(m: ReportModel, f: ReturnType<typeof reportFormats>) {
  const doc = new PDFDocument({
    size: PAPER[m.paper],
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN + FOOTER },
    // The embedded Roboto: no built-in font files are read from disk.
    font: REGULAR as unknown as string,
    bufferPages: true,
    tagged: true,
    lang: 'en',
    displayTitle: true,
    pdfVersion: '1.7',
    info: {
      Title: `${m.title}, ${f.day(m.from)} to ${f.day(m.to)}`,
      // pdfkit reads every entry: an absent author is left out, not undefined.
      ...(m.driverName ? { Author: m.driverName } : {}),
      Subject: 'Mileage log, mileage deduction and expenses for an accountant. Not tax advice.',
      Creator: `MileWage ${m.version}`,
      Keywords: 'mileage log, expenses, MileWage',
      CreationDate: new Date(m.generatedAt),
    },
  });
  doc.registerFont('regular', REGULAR);
  doc.registerFont('bold', BOLD);
  const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = () => doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const root = doc.struct('Document');
  doc.addStructure(root);

  const artifact = (draw: () => void) => {
    doc.markContent('Artifact');
    draw();
    doc.endMarkedContent();
  };
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const heading = (parent: PDFKit.PDFStructureElement, text: string, level: 'H1' | 'H2') => {
    const size = level === 'H1' ? 18 : 12.5;
    // A heading is never the last thing on a page: room for it and a few lines under it.
    ensure(level === 'H1' ? size * 3 : 80);
    if (level === 'H2') doc.moveDown(0.8);
    parent.add(
      doc.struct(level, {}, () =>
        doc
          .font('bold')
          .fontSize(size)
          .fillColor(INK)
          .text(text, left(), doc.y, { width: width() }),
      ),
    );
    doc.moveDown(level === 'H1' ? 0.3 : 0.35);
  };
  const paragraph = (parent: PDFKit.PDFStructureElement, text: string, muted = false) => {
    doc.font('regular').fontSize(9);
    ensure(doc.heightOfString(text, { width: width() }) + 2);
    parent.add(
      doc.struct('P', {}, () =>
        doc.fillColor(muted ? MUTED : INK).text(text, left(), doc.y, { width: width() }),
      ),
    );
  };

  /** A table whose header row repeats on every page it runs onto. */
  const table = (
    parent: PDFKit.PDFStructureElement,
    columns: Column[],
    rows: Cell[][],
    o: { size?: number; totals?: Cell[] } = {},
  ) => {
    const size = o.size ?? 8.5;
    const pad = 3;
    const t = doc.struct('Table');
    parent.add(t);
    const widths = () => {
      const total = columns.reduce((a, c) => a + c.share, 0);
      return columns.map((c) => (c.share / total) * width());
    };
    const textOf = (cell: Cell) => (typeof cell === 'string' ? cell : cell.text);
    const subOf = (cell: Cell) => (typeof cell === 'string' ? undefined : cell.sub);
    const heightOf = (cells: Cell[], font: string) => {
      const w = widths();
      return (
        Math.max(
          ...cells.map((cell, i) => {
            doc.font(font).fontSize(size);
            let h = doc.heightOfString(textOf(cell) || ' ', { width: w[i]! - pad * 2 });
            const sub = subOf(cell);
            if (sub) {
              doc.font('regular').fontSize(size - 1.5);
              h += doc.heightOfString(sub, { width: w[i]! - pad * 2 });
            }
            return h;
          }),
        ) +
        pad * 2
      );
    };
    /** A header row (`TH` cells, bold, shaded) or a data row (`TD`). */
    const drawRow = (cells: Cell[], header: boolean) => {
      const kind = header ? 'TH' : 'TD';
      const shade = header;
      const font = header ? 'bold' : 'regular';
      const h = heightOf(cells, font);
      const y = doc.y;
      const w = widths();
      artifact(() => {
        if (shade) doc.rect(left(), y, width(), h).fill(FILL);
        doc
          .moveTo(left(), y + h)
          .lineTo(left() + width(), y + h)
          .lineWidth(0.5)
          .strokeColor(RULE)
          .stroke();
      });
      const tr = doc.struct('TR');
      t.add(tr);
      let x = left();
      cells.forEach((cell, i) => {
        const col = columns[i]!;
        const cx = x;
        tr.add(
          doc.struct(kind, {}, () => {
            doc
              .font(font)
              .fontSize(size)
              .fillColor(INK)
              .text(textOf(cell), cx + pad, y + pad, {
                width: w[i]! - pad * 2,
                align: col.align ?? 'left',
              });
            const sub = subOf(cell);
            if (sub) {
              doc
                .font('regular')
                .fontSize(size - 1.5)
                .fillColor(MUTED)
                .text(sub, cx + pad, doc.y, { width: w[i]! - pad * 2, align: col.align ?? 'left' });
            }
          }),
        );
        x += w[i]!;
      });
      tr.end();
      doc.x = left();
      doc.y = y + h;
    };
    const header = columns.map((c) => c.label);
    const headerH = heightOf(header, 'bold');
    ensure(headerH * 2);
    drawRow(header, true);
    for (const row of rows) {
      if (doc.y + heightOf(row, 'regular') > bottom()) {
        doc.addPage();
        drawRow(header, true);
      }
      drawRow(row, false);
    }
    if (o.totals) {
      if (doc.y + heightOf(o.totals, 'bold') > bottom()) {
        doc.addPage();
        drawRow(header, true);
      }
      drawRow(o.totals, true);
    }
    t.end();
    doc.moveDown(0.6);
  };

  /** Label and value pairs, as a two-column table with the labels as row headers. */
  const pairs = (parent: PDFKit.PDFStructureElement, items: [string, string][]) => {
    const t = doc.struct('Table');
    parent.add(t);
    const labelW = width() * 0.36;
    for (const [label, value] of items) {
      doc.font('regular').fontSize(9.5);
      const h = Math.max(
        doc.heightOfString(value, { width: width() - labelW }),
        doc.heightOfString(label, { width: labelW - 8 }),
      );
      ensure(h + 3);
      const y = doc.y;
      const tr = doc.struct('TR');
      t.add(tr);
      tr.add(
        doc.struct('TH', {}, () =>
          doc
            .font('regular')
            .fontSize(9.5)
            .fillColor(MUTED)
            .text(label, left(), y, { width: labelW - 8 }),
        ),
      );
      tr.add(
        doc.struct('TD', {}, () =>
          doc
            .font('regular')
            .fontSize(9.5)
            .fillColor(INK)
            .text(value, left() + labelW, y, {
              width: width() - labelW,
            }),
        ),
      );
      tr.end();
      doc.x = left();
      doc.y = y + h + 3;
    }
    t.end();
  };

  // Cover block.
  const cover = doc.struct('Sect');
  root.add(cover);
  heading(cover, m.title, 'H1');
  pairs(cover, [
    ['Driver', m.driverName ?? 'No name set (Settings > Profile and region)'],
    ['Period', `${f.day(m.from)} to ${f.day(m.to)}`],
    [
      m.vehicleOnly ? 'Vehicle' : 'Vehicles',
      m.vehicleOnly
        ? `${m.vehicleOnly} only`
        : m.vehicles.length
          ? m.vehicles.join(', ')
          : 'No shifts in this period',
    ],
    [
      'Country',
      `${countryName(m.country)}. Distances in ${f.unit === 'mi' ? 'miles' : 'kilometres'}`,
    ],
    ['Generated', f.stamp(m.generatedAt)],
    ['Made with', `MileWage ${m.version}`],
  ]);
  doc.moveDown(0.5);
  const notice = doc.struct('Div');
  cover.add(notice);
  for (const n of m.notices) paragraph(notice, n, true);
  notice.end();
  cover.end();

  // Summary.
  const summary = doc.struct('Sect');
  root.add(summary);
  heading(summary, 'Summary', 'H2');
  const items: [string, string][] = [
    ['Shifts', String(m.shifts)],
    ['Total distance', f.distance(m.totalM)],
    ['Business distance', f.distance(m.businessM)],
    ['Personal distance', f.distance(m.personalM)],
    ['Mileage deduction', f.money(m.mileageCents)],
  ];
  if (m.mileageRate) items.push(['Rate used', rateUsedWords(m, f)]);
  if (m.actualExpenses.length) {
    items.push([
      'Deducted by actual expenses',
      `${m.actualExpenses.join(', ')}: no mileage deduction for the year it is chosen`,
    ]);
  }
  if (m.expenses) {
    items.push(['Expenses', f.money(m.expenses.spentCents)]);
    items.push(['Deductible expenses', f.money(m.expenses.deductibleCents)]);
    if (m.expenses.coveredCents) {
      items.push([
        'Covered by the mileage rate',
        `${f.money(m.expenses.coveredCents)} (not deducted again)`,
      ]);
    }
  }
  if (m.earnings) {
    items.push([
      'Earnings after app fees',
      m.earnings.totalCents === null ? 'Not entered' : f.money(m.earnings.totalCents),
    ]);
    if (m.earnings.totalCents !== null) {
      items.push(['Of which tips', f.money(m.earnings.tipsCents)]);
      if (m.earnings.feesCents) items.push(['App fees taken', f.money(-m.earnings.feesCents)]);
    }
  }
  pairs(summary, items);

  heading(summary, 'Mileage rates used', 'H2');
  if (m.rates.length === 0) {
    paragraph(summary, 'No shift in this period has a mileage deduction value.', true);
  } else {
    table(
      summary,
      [
        { label: 'Rate', share: 3 },
        { label: 'Applies to', share: 1.4 },
        { label: 'From', share: 1.3 },
        { label: 'Amount', share: 1.6, align: 'right' },
      ],
      m.rates.map((r) =>
        r.source === 'official'
          ? [
              { text: `Country rate: ${r.label}`, sub: 'Published rate' },
              r.vehicleKind,
              f.day(r.from),
              f.rate(r.centsPerUnit, r.unit),
            ]
          : [
              { text: 'Your mileage rate', sub: 'Entered by you, not an official rate' },
              'cars, vans, motorcycles',
              r.from ? f.day(r.from) : 'From the start',
              f.rate(r.centsPerUnit, r.unit),
            ],
      ),
    );
  }

  if (m.expenses) {
    heading(summary, 'Expenses by category', 'H2');
    if (m.expenses.byCategory.length === 0) {
      paragraph(summary, 'No expenses in this period.', true);
    } else {
      table(
        summary,
        [
          { label: 'Category', share: 3 },
          { label: 'Entries', share: 1, align: 'right' },
          { label: 'Spent', share: 1.6, align: 'right' },
          { label: 'Deductible', share: 1.6, align: 'right' },
        ],
        m.expenses.byCategory.map((x) => [
          x.coveredCents
            ? {
                text: label(x.category),
                sub: `${f.money(x.coveredCents)} covered by the mileage rate`,
              }
            : label(x.category),
          String(x.count),
          f.money(x.spentCents),
          f.money(x.deductibleCents),
        ]),
        {
          totals: [
            'Total',
            String(m.expenses.rows.length),
            f.money(m.expenses.spentCents),
            f.money(m.expenses.deductibleCents),
          ],
        },
      );
    }
  }
  summary.end();

  // The mileage log, one row per shift.
  const logSect = doc.struct('Sect');
  root.add(logSect);
  heading(logSect, 'Mileage log', 'H2');
  paragraph(
    logSect,
    'One row per shift. Business distance is the total less trips marked personal. Times are in ' +
      'your time zone. Odometer readings are shown where you noted them.',
    true,
  );
  doc.moveDown(0.3);
  if (m.log.length === 0) {
    paragraph(logSect, 'No ended shifts in this period.', true);
  } else {
    table(
      logSect,
      [
        { label: 'Date', share: 1.25 },
        { label: 'Time', share: 1.15 },
        { label: 'Vehicle', share: 1.15 },
        { label: 'Platform', share: 1.15 },
        { label: `Business (${f.unit})`, share: 0.95, align: 'right' },
        { label: `Personal (${f.unit})`, share: 0.95, align: 'right' },
        { label: 'Odometer', share: 1.25 },
        { label: 'Deduction', share: 1.1, align: 'right' },
        { label: 'Notes', share: 1.9 },
      ],
      m.log.map((r) => {
        const s = r.shift;
        const odo =
          r.odometer.startM === null && r.odometer.endM === null
            ? ''
            : `${r.odometer.startM === null ? '?' : f.odometer(r.odometer.startM)} to ${
                r.odometer.endM === null ? '?' : f.odometer(r.odometer.endM)
              }`;
        return [
          f.day(s.localDate),
          `${f.time(s.startedAt)} to ${s.endedAt === null ? '' : f.time(s.endedAt)}`,
          m.vehicleNames.get(s.vehicleId) ?? '',
          r.platforms.join(', '),
          f.distance(r.businessM).replace(` ${f.unit}`, ''),
          f.distance(r.personalM).replace(` ${f.unit}`, ''),
          odo,
          r.deduction.cents === null
            ? ''
            : {
                text: f.money(r.deduction.cents),
                sub: r.deduction.rate === 'yours' ? 'your rate' : undefined,
              },
          [s.notes, ...r.flags].filter(Boolean).join('; '),
        ];
      }),
      {
        size: 7.5,
        totals: [
          'Total',
          `${m.shifts} shifts`,
          '',
          '',
          f.distance(m.businessM).replace(` ${f.unit}`, ''),
          f.distance(m.personalM).replace(` ${f.unit}`, ''),
          '',
          m.mileageCents === null ? '' : f.money(m.mileageCents),
          '',
        ],
      },
    );
  }
  logSect.end();

  if (m.expenses) {
    const exp = doc.struct('Sect');
    root.add(exp);
    heading(exp, 'Expenses', 'H2');
    if (m.expenses.rows.length === 0) {
      paragraph(exp, 'No expenses in this period.', true);
    } else {
      const covered = m.expenses.covered;
      table(
        exp,
        [
          { label: 'Date', share: 1.2 },
          { label: 'Category', share: 1.6 },
          { label: 'Merchant', share: 1.6 },
          { label: 'Vehicle', share: 1.1 },
          { label: 'Amount', share: 1.1, align: 'right' },
          { label: 'Deductible', share: 1.2, align: 'right' },
          { label: 'Notes', share: 2.2 },
        ],
        m.expenses.rows.map((e) => [
          f.day(e.spentOn),
          label(e.category),
          e.merchant,
          e.vehicleId === null ? '' : (m.vehicleNames.get(e.vehicleId) ?? ''),
          f.money(e.amountCents),
          covered.has(e.id)
            ? { text: f.money(0), sub: 'covered by the mileage rate' }
            : {
                text: f.money(deductibleCents(e)),
                sub:
                  e.deductible !== 1
                    ? 'not deductible'
                    : e.businessPct < 100
                      ? `${e.businessPct}% for work`
                      : undefined,
              },
          [e.notes, e.shiftId === null ? null : 'during a shift'].filter(Boolean).join('; '),
        ]),
        {
          size: 7.5,
          totals: [
            'Total',
            '',
            '',
            '',
            f.money(m.expenses.spentCents),
            f.money(m.expenses.deductibleCents),
            '',
          ],
        },
      );
    }
    exp.end();
  }

  // The same notice closes the report, so a printed last page carries it too.
  const end = doc.struct('Sect');
  root.add(end);
  heading(end, 'About these figures', 'H2');
  for (const n of m.notices) paragraph(end, n);
  paragraph(
    end,
    'Distances come from the GPS track recorded on the phone. MileWage makes no claim that this file meets a tax office’s record-keeping rules.',
    true,
  );
  end.end();
  root.end();

  // Page numbers on every page, as artifacts.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin must not open a new page
    const y = doc.page.height - MARGIN - 10;
    artifact(() => {
      doc
        .font('regular')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`${m.title} · ${f.day(m.from)} to ${f.day(m.to)}`, left(), y, {
          width: width() / 2,
          lineBreak: false,
        })
        .text(`Page ${i + 1} of ${range.count}`, left() + width() / 2, y, {
          width: width() / 2,
          align: 'right',
          lineBreak: false,
        });
    });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return doc;
}

const label = (slug: string) => expenseCategory(slug)?.label ?? slug;

/** Which rate valued the period, in words; your rate is never presented as official (Q5). */
function rateUsedWords(m: ReportModel, f: ReturnType<typeof reportFormats>) {
  if (m.mileageRate === 'official') return 'The country rate';
  if (m.mileageRate === 'yours') return 'Your mileage rate (not an official rate)';
  const from = m.rates.find((r) => r.source === 'yours')?.from;
  return `The country rate before ${from ? f.day(from) : 'your rate starts'}, then your mileage rate (not an official rate)`;
}

/** `GET /exports/pdf`: the mileage and expenses report for an accountant. */
export const pdfExporter: Exporter = {
  format: 'pdf',
  standalone: true,
  contentType: 'application/pdf',
  extension: 'pdf',
  requires: [],
  run(c: ExportContext) {
    const model = reportModel(c);
    return renderReport(model, reportFormats(c));
  },
};
