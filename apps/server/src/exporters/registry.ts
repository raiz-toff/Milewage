import type { Db, ShiftRow, StopLabelRow, StopRow, TripRow, VehicleRow } from '../db';

/** What an exporter is given: the selected shifts and the owner's presentation settings, never the request. */
export interface ExportContext {
  db: Db;
  userId: number;
  shifts: readonly ShiftRow[];
  vehicles: ReadonlyMap<number, VehicleRow>;
  unit: 'km' | 'mi';
  currency: string;
  timeZone: string;
  /** CSV only. */
  level: 'trip' | 'shift';
  /** True when the stops module and setting are on, so stops and labels may be read. */
  stopsOn: boolean;
  readers: {
    trips(shiftId: number): TripRow[];
    stops(shiftId: number): StopRow[];
    labels(shiftId: number): StopLabelRow[];
    /** Points of a shift in time order: the raw ones, or the vertices of its route archive. */
    points(shiftId: number): Iterable<{
      t: number;
      latE7: number;
      lonE7: number;
      speedDmps: number | null;
      altitudeM: number | null;
    }>;
    /** True when the raw points were replaced by the simplified route archive (07 section 4.2). */
    simplified(shiftId: number): boolean;
    deduction(shift: ShiftRow): number | null;
  };
}

export interface Exporter {
  /** `csv`, `gpx`, ...: the `{format}` of `GET /exports/{format}`. */
  format: string;
  contentType: string;
  extension: string;
  /** Modules that must be on for this format to exist (08 section 11), besides `exporters` and core. */
  requires: readonly string[];
  /** Chunks of the file; produced lazily so a year of data never sits in memory. */
  run(ctx: ExportContext): Iterable<string>;
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
