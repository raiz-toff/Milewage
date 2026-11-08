import { z } from 'zod';
import { ENTRY_TYPES } from '../db';
import { ok, type ToolContext, type ToolSpec } from './tools';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A day, YYYY-MM-DD, in the driver’s time zone.');
const id = z.number().int().min(1);
const cents = (what: string) =>
  z.number().int().describe(`${what} in integer cents of the driver’s currency: 12.50 is 1250.`);

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
];
