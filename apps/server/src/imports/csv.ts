// A small RFC 4180 reader and the helpers the CSV import needs (18 section 12). No vendor format is
// known: the driver maps the file's own columns on screen, and the guesses here only pre-fill that.

/** Rows of cells; handles quotes, doubled quotes, CRLF or LF, and a leading byte-order mark. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

export const FIELDS = {
  expenses: {
    spent_on: ['date', 'spent_on', 'day', 'expense_date'],
    category: ['category', 'type'],
    amount: ['amount', 'total', 'cost', 'price'],
    merchant: ['merchant', 'vendor', 'payee', 'store', 'description'],
    deductible: ['deductible', 'is_deductible'],
    business_pct: ['business_use_pct', 'business_pct', 'business_use', 'business'],
    notes: ['notes', 'note', 'memo'],
  },
  shifts: {
    date: ['date', 'shift_date', 'day', 'start_date'],
    start_time: ['start_time', 'start', 'started', 'time_in'],
    end_time: ['end_time', 'end', 'ended', 'time_out'],
    duration_min: ['duration_min', 'duration', 'minutes', 'total_minutes'],
    distance: ['distance', 'total_distance', 'miles', 'km', 'kilometres', 'mileage'],
    vehicle: ['vehicle', 'car', 'vehicle_name'],
    platform: ['platform', 'app', 'service'],
    gross: ['gross', 'gross_pay', 'earnings', 'pay', 'base_pay'],
    tips: ['tips', 'tip'],
    bonus: ['bonus', 'incentive', 'promotion'],
    notes: ['notes', 'note', 'memo'],
  },
} as const;
export type ImportKind = keyof typeof FIELDS;

/** The columns of the header that look like each field (first match wins, one column per field). */
export function guessMapping(kind: ImportKind, header: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const [field, names] of Object.entries(FIELDS[kind])) {
    const hit = header.find((h) => !used.has(h) && (names as readonly string[]).includes(norm(h)));
    out[field] = hit ?? null;
    if (hit) used.add(hit);
  }
  return out;
}

/** "$1,234.50" to 123450 cents; NaN when it is not an amount. */
export function toCents(text: string): number {
  const t = text.trim().replace(/[$,\s]/g, '');
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
}

export function toBool(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(t)) return true;
  if (['no', 'n', 'false', '0'].includes(t)) return false;
  return undefined;
}

/** `YYYY-MM-DD` from ISO or `MM/DD/YYYY`-free input; only unambiguous forms are accepted. */
export function toDate(text: string): string | undefined {
  const t = text.trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const d = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(d) ? d : undefined;
}

/** `HH:MM` (24-hour) in minutes since midnight, or undefined. */
export function toMinutes(text: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return undefined;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}
