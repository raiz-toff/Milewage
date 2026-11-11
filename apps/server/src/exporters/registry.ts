import type { EffectiveRow } from '../db';
import type { DriverContext } from '../driver-context';
import type { MileageDeduction, ValuedShift } from '../mileage-deduction';
import type { TaxReport } from '../tax-report';
import type { Db, ShiftRow, StopLabelRow, StopRow, TripRow, VehicleRow } from '../db';

/** What an exporter is given: the selected shifts and the owner's presentation settings, never the request. */
export interface ExportContext {
  db: Db;
  userId: number;
  shifts: readonly ShiftRow[];
  vehicles: ReadonlyMap<number, VehicleRow>;
  /** The owner's settings for this request: unit, currency, time zone, today, rates, stop detection. */
  driver: DriverContext;
  /** Mileage deductions, deduction methods and double-counted expenses. */
  deduction: MileageDeduction;
  /** CSV only. */
  level: 'trip' | 'shift';
  /** Query parameters of the request that the standalone report exporters read. */
  query: {
    from?: string;
    to?: string;
    year?: number;
    category?: string;
    format?: string;
    vehicle_id?: number;
    paper?: 'a4' | 'letter';
  };
  /** The server's clock (the report's "generated" time). */
  now: () => number;
  /** Whether a module is on (a report leaves out what a switched-off module would have said). */
  enabled(module: string): boolean;
  /** The tax report of a year; present when the `tax` module is on. */
  taxReport?: (year: number) => TaxReport;
  readers: {
    trips(shiftId: number): TripRow[];
    stops(shiftId: number): StopRow[];
    labels(shiftId: number): StopLabelRow[];
    /** The shift's mileage deduction and the rate that valued it (the country's or yours). */
    deduction(shift: ShiftRow): ValuedShift;
    /** The shift's effective earnings per platform (labels and typed totals); empty when none. */
    earnings(shift: ShiftRow): EffectiveRow[];
    /** The effective earnings of every shift dated in `[from, to]`; empty when the earnings module is off. */
    earningsBetween(from: string, to: string): EffectiveRow[];
  };
}

export interface Exporter {
  /** `csv`, `pdf`, ...: the `{format}` of `GET /exports/{format}`. */
  format: string;
  contentType: string;
  extension: string;
  /** Modules that must be on for this format to exist (08 section 11), besides `exporters` and core. */
  requires: readonly string[];
  /** A report over records other than shifts (expenses, tax): the route selects no shifts for it. */
  standalone?: boolean;
  /** Content type and extension that depend on the request (`tax_summary` is CSV or JSON). */
  describe?(c: ExportContext): { contentType: string; extension: string };
  /**
   * Chunks of the file; produced lazily so a year of data never sits in memory. A binary file (the
   * PDF) is a stream of bytes. A refusal (a bad period) is thrown before the first chunk.
   */
  run(ctx: ExportContext): Iterable<string> | AsyncIterable<string | Uint8Array>;
}

/** The only attach point for a new format: a file that calls `register` (08 section 16.3). */
export function createExporterRegistry(initial: readonly Exporter[] = []) {
  const byFormat = new Map(initial.map((e) => [e.format, e]));
  return {
    register: (e: Exporter) => void byFormat.set(e.format, e),
    get: (format: string) => byFormat.get(format),
    formats: () => [...byFormat.keys()],
  };
}
export type ExporterRegistry = ReturnType<typeof createExporterRegistry>;
