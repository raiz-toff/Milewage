import { z } from 'zod';
import { localDate } from '../time';
import type { McpScope } from './tokens';

/** One in-process REST call made as the owner (plan 26 section 3.3). */
export type Api = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: object,
) => Promise<{ status: number; body: unknown }>;

export interface ToolContext {
  api: Api;
  /** Whether a server module is on; tools of an absent module are not listed. */
  on: (module: string) => boolean;
  /** The owner's `GET /settings`, fetched once per MCP request. */
  settings: () => Promise<Record<string, unknown>>;
  now: () => number;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  /** Listed only when this module is on. */
  module?: string;
  input: z.ZodObject;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** A REST problem, turned into a tool result with `isError: true` that the model can act on. */
export class ToolProblem extends Error {}

/** The REST answer, or a ToolProblem with the problem's title, detail and field errors. */
export async function ok(res: Promise<{ status: number; body: unknown }>) {
  const { status, body } = await res;
  if (status < 400) return body;
  const p = (body ?? {}) as {
    title?: string;
    detail?: string;
    errors?: { path: string; message: string }[];
  };
  const fields = (p.errors ?? []).map((e) => `${e.path} ${e.message}`);
  throw new ToolProblem(
    [`${p.title ?? `HTTP ${status}`}: ${p.detail ?? ''}`.trim(), ...fields].join('\n'),
  );
}

/** `?a=1&b=x` from the arguments that are set, in the given order. */
export const query = (args: Record<string, unknown>, keys: string[]) => {
  const q = new URLSearchParams();
  for (const k of keys) if (args[k] !== undefined && args[k] !== null) q.set(k, String(args[k]));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A day, YYYY-MM-DD, in the driver’s time zone.');

/** How every result's numbers are meant; sent with each result so the model never guesses. */
export async function unitsOf(ctx: ToolContext) {
  const s = await ctx.settings();
  return {
    money: `integer cents of ${String(s.currency).toUpperCase()} (12.50 is 1250)`,
    distance: `integer metres; the driver reads distances in ${String(s.distance_unit)}`,
    time: `instants are UTC epoch milliseconds; days are YYYY-MM-DD in ${String(s.timezone)}`,
  };
}

/** The read tools, in the order `tools/list` gives them (plan 26 section 3.5). */
export const readTools: ToolSpec[] = [
  {
    name: 'get_profile',
    title: 'Driver profile and units',
    description:
      'Call this first. The driver’s country, region, currency, distance unit, time zone, today’s date, vehicles, platforms (apps they drive for), expense categories and which MileWage features are on.',
    scope: 'read',
    input: z.object({}),
    async run(_args, ctx) {
      const s = await ctx.settings();
      const [vehicles, platforms, categories] = await Promise.all([
        ok(ctx.api('GET', '/vehicles')),
        ctx.on('platforms') ? ok(ctx.api('GET', '/platforms')) : null,
        ctx.on('expenses') ? ok(ctx.api('GET', '/expenses/categories')) : null,
      ]);
      const today = localDate(ctx.now(), String(s.timezone));
      const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, s[k]]));
      return {
        ...pick(['display_name', 'country', 'region', 'currency', 'distance_unit', 'timezone']),
        ...pick(['week_start', 'time_format', 'default_vehicle_id', 'modules']),
        today,
        vehicles,
        platforms,
        expense_categories: categories,
      };
    },
  },
  {
    name: 'get_summary',
    title: 'Totals for a period',
    description:
      'Shift count, hours, earnings and tips, active/deadhead/personal distance, the mileage deduction and earnings per hour for a period (default: this month). `platform` filters earnings only.',
    scope: 'read',
    input: z.object({
      from: day.optional(),
      to: day.optional(),
      platform: z
        .string()
        .regex(/^[a-z0-9_]{1,32}$/)
        .optional()
        .describe('Platform slug from get_profile.'),
    }),
    run: (a, ctx) => ok(ctx.api('GET', `/summary${query(a, ['from', 'to', 'platform'])}`)),
  },
];
