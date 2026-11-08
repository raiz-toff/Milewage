import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ENTRY_TYPES } from '../db';
import { ok, ToolProblem, type ToolContext, type ToolSpec } from './tools';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A day, YYYY-MM-DD, in the driver’s time zone.');
const id = z.number().int().min(1);
const cents = (what: string) =>
  z.number().int().describe(`${what} in integer cents of the driver’s currency: 12.50 is 1250.`);

const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .describe('Local time in the driver’s time zone, YYYY-MM-DDTHH:mm.');
/** Metres in one of the driver's units (1 mi = 1609.344 m, the international mile). */
export const metresPer = (unit: string) => (unit === 'mi' ? 1609.344 : 1000);

/** The instant a local wall-clock time `YYYY-MM-DDTHH:mm` names in an IANA zone. */
export function epochOf(local: string, timeZone: string): number {
  const [y, mo, d, h, mi] = local.split(/[-T:]/).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  let at = wall;
  // Twice: the zone's offset at the first guess may differ from the offset at the answer (DST).
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, Number(x.value)]));
    at += wall - Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
  }
  return at;
}

/** `CA$54.20`: the amount as the driver reads it, for the confirmation text. */
export async function money(ctx: ToolContext, amountCents: number) {
  const s = await ctx.settings();
  return new Intl.NumberFormat(`en-${String(s.country).toUpperCase()}`, {
    style: 'currency',
    currency: String(s.currency).toUpperCase(),
  }).format(amountCents / 100);
}

const expenseFields = {
  spent_on: day,
  category: z.string().min(1).max(40).describe('A category slug from get_profile.'),
  amount_cents: cents('The amount paid').min(1).max(1_000_000_000),
  merchant: z.string().max(120).optional().describe('Where it was paid, e.g. "Esso".'),
  deductible: z.boolean().optional().describe('Leave out to use the category’s default.'),
  business_pct: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Business share in percent; leave out for the category’s default.'),
  vehicle_id: id.nullable().optional(),
  shift: id.nullable().optional().describe('The shift id it belongs to, if any.'),
  notes: z.string().max(2000).nullable().optional(),
};
/** REST field names: `shift` is `shift_id`; unset fields are left out. */
const expenseBody = (a: Record<string, unknown>) => {
  const { shift, ...rest } = a;
  const set = Object.entries(rest).filter(([k, v]) => k !== 'id' && v !== undefined);
  const body = Object.fromEntries(set);
  return shift === undefined ? body : { ...body, shift_id: shift };
};
type Expense = {
  id: number;
  category: string;
  amount_cents: number;
  spent_on: string;
  merchant: string;
};
const describe = async (ctx: ToolContext, e: Expense) =>
  `${e.category} ${await money(ctx, e.amount_cents)} on ${e.spent_on}${e.merchant ? ` at ${e.merchant}` : ''}`;

const UNDO = 'To undo, open it in MileWage on the web and delete or edit it.';

/** The write tools (plan 26 section 3.5); a `read` token never sees them. */
export const writeTools: ToolSpec[] = [
  {
    name: 'add_expense',
    title: 'Add an expense',
    description:
      'Record an expense the driver paid. Before calling, repeat the date, category, amount and merchant to the driver and ask if anything is unclear. Answers the stored expense.',
    scope: 'write',
    module: 'expenses',
    annotations: { destructiveHint: false, idempotentHint: false },
    input: z.object(expenseFields),
    run: (a, ctx) => ok(ctx.api('POST', '/expenses', expenseBody(a))),
    target: (r) => `expense:${(r as Expense).id}`,
    say: async (r, ctx) =>
      `Added expense #${(r as Expense).id}: ${await describe(ctx, r as Expense)}. ${UNDO}`,
  },
  {
    name: 'update_expense',
    title: 'Change an expense',
    description:
      'Change fields of an existing expense (id from list_expenses). Only the fields given change. Answers the expense before and after.',
    scope: 'write',
    module: 'expenses',
    annotations: { destructiveHint: true, idempotentHint: true },
    input: z.object({ id, ...z.object(expenseFields).partial().shape }),
    async run(a, ctx) {
      const before = await ok(ctx.api('GET', `/expenses/${Number(a.id)}`));
      const after = await ok(ctx.api('PATCH', `/expenses/${Number(a.id)}`, expenseBody(a)));
      return { before, after };
    },
    target: (r) => `expense:${(r as { after: Expense }).after.id}`,
    say: async (r, ctx) => {
      const { before, after } = r as { before: Expense; after: Expense };
      return `Changed expense #${after.id} from ${await describe(ctx, before)} to ${await describe(ctx, after)}.`;
    },
  },
  {
    name: 'add_earning_entry',
    title: 'Add an earnings line to a shift',
    description:
      'Add one line of pay for a platform on a shift: a fare, tip, bonus or top-up is above zero; a commission, platform fee or tax withheld is below zero. Lines cannot be edited: to fix one, the driver deletes it on the web and you add it again.',
    scope: 'write',
    module: 'earnings',
    annotations: { destructiveHint: false, idempotentHint: false },
    input: z.object({
      shift: id.describe('The shift id (from list_shifts).'),
      platform: z
        .string()
        .regex(/^[a-z0-9_]{1,32}$/)
        .describe('A platform slug from get_profile.'),
      type: z.enum(ENTRY_TYPES),
      amount_cents: cents('The amount').min(-1_000_000_000).max(1_000_000_000),
      note: z.string().max(2000).nullable().optional(),
    }),
    run: (a, ctx) =>
      ok(
        ctx.api('POST', `/shifts/${Number(a.shift)}/earnings/${String(a.platform)}/entries`, {
          type: a.type,
          amount_cents: a.amount_cents,
          ...(a.note === undefined ? {} : { note: a.note }),
        }),
      ),
    target: (_r, a) => `shift:${Number(a.shift)}`,
    say: async (_r, ctx, a) =>
      `Added ${String(a.type)} ${await money(ctx, Number(a.amount_cents))} for ${String(a.platform)} to shift #${Number(a.shift)}. ${UNDO}`,
  },
  {
    name: 'update_shift',
    title: 'Change a shift’s notes or vehicle',
    description:
      'Change the notes or the vehicle of a shift (id from list_shifts). The old values are kept in MileWage’s change history. Answers the shift before and after.',
    scope: 'write',
    annotations: { destructiveHint: true, idempotentHint: true },
    input: z.object({
      shift: id.describe('The shift id (from list_shifts).'),
      notes: z.string().max(2000).nullable().optional(),
      vehicle_id: id.optional(),
    }),
    async run(a, ctx) {
      const ref = `/shifts/${Number(a.shift)}`;
      const before = await ok(ctx.api('GET', ref));
      const body = Object.fromEntries(
        ['notes', 'vehicle_id'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]),
      );
      return { before, after: await ok(ctx.api('PATCH', ref, body)) };
    },
    target: (_r, a) => `shift:${Number(a.shift)}`,
    say: async (_r, _ctx, a) =>
      `Changed shift #${Number(a.shift)}: ${['notes', 'vehicle_id'].filter((k) => a[k] !== undefined).join(' and ')}. The old values are in the shift’s change history.`,
  },
  {
    name: 'record_odometer',
    title: 'Record an odometer reading',
    description:
      'Record what the odometer showed, in the driver’s distance unit (km or mi, from get_profile): at the start or end of a shift (give `shift`), or at the start or end of the year for the tax logbook (give `vehicle_id`). A newer reading of the same kind for that shift replaces the older one.',
    scope: 'write',
    annotations: { destructiveHint: true, idempotentHint: true },
    input: z.object({
      kind: z.enum(['shift_start', 'shift_end', 'year_start', 'year_end']),
      reading: z.number().min(0).max(10_000_000).describe('The odometer, in the driver’s unit.'),
      at: localTime.describe('When it was read, local time YYYY-MM-DDTHH:mm.'),
      shift: id.optional().describe('For shift_start and shift_end.'),
      vehicle_id: id.optional().describe('For year_start and year_end.'),
    }),
    async run(a, ctx) {
      const s = await ctx.settings();
      const body = {
        reading_m: Math.round(Number(a.reading) * metresPer(String(s.distance_unit))),
        recorded_at: epochOf(String(a.at), String(s.timezone)),
      };
      const kind = String(a.kind);
      if (kind.startsWith('shift_')) {
        if (a.shift === undefined) throw new ToolProblem('Give `shift` for a shift reading.');
        return ok(ctx.api('PUT', `/shifts/${Number(a.shift)}/odometer/${kind}`, body));
      }
      if (a.vehicle_id === undefined)
        throw new ToolProblem('Give `vehicle_id` for a year reading.');
      return ok(ctx.api('POST', '/odometer', { ...body, kind, vehicle_id: a.vehicle_id }));
    },
    target: (r) => `odometer:${(r as { id: number }).id}`,
    say: async (_r, ctx, a) =>
      `Recorded ${String(a.kind).replace('_', ' ')} odometer ${Number(a.reading)} ${String((await ctx.settings()).distance_unit)} at ${String(a.at)}.`,
  },
  {
    name: 'add_trip',
    title: 'Add a trip by hand',
    description:
      'Add a trip the phone did not record to a shift that is not finalized: `active` (with an order), `deadhead` (driving to the next order) or `personal`. Times are local, YYYY-MM-DDTHH:mm; distance is in the driver’s unit.',
    scope: 'write',
    annotations: { destructiveHint: false, idempotentHint: false },
    input: z.object({
      shift: id.describe('The shift id (from list_shifts).'),
      kind: z.enum(['active', 'deadhead', 'personal']),
      started_at: localTime,
      ended_at: localTime,
      distance: z.number().positive().max(10_000).describe('In the driver’s unit (km or mi).'),
      purpose: z.string().min(1).max(200).describe('What the trip was for, e.g. "DoorDash order".'),
    }),
    async run(a, ctx) {
      const s = await ctx.settings();
      const tz = String(s.timezone);
      const body = {
        kind: a.kind,
        started_at: epochOf(String(a.started_at), tz),
        ended_at: epochOf(String(a.ended_at), tz),
        distance_m: Math.max(
          1,
          Math.round(Number(a.distance) * metresPer(String(s.distance_unit))),
        ),
        purpose: a.purpose,
        edited_at: ctx.now(),
      };
      return ok(ctx.api('PUT', `/shifts/${Number(a.shift)}/trips/${randomUUID()}`, body));
    },
    target: (_r, a) => `shift:${Number(a.shift)}`,
    say: async (_r, ctx, a) =>
      `Added a ${String(a.kind)} trip of ${Number(a.distance)} ${String((await ctx.settings()).distance_unit)} to shift #${Number(a.shift)}, ${String(a.started_at)} to ${String(a.ended_at)}. ${UNDO}`,
  },
];
