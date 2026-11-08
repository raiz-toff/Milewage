import type { Db } from '../db';
import { ToolProblem } from './tools';

/** Changes one token may make per minute (plan 26 section 3.7), on top of the request limit. */
export const WRITES_PER_MINUTE = 30;

/** The write guard: a per-token minute window, and one `mcp_audit` row per write tool call. */
export function createWriteGuard(db: Db, now: () => number) {
  const recent = new Map<number, number[]>(); // token id -> times of its changes in the last minute
  const insert = db.prepare(
    'INSERT INTO mcp_audit (user_id, token_id, at, tool, outcome, target, args) VALUES (@userId, @tokenId, @at, @tool, @outcome, @target, @args)',
  );
  return {
    /** Counts one change, or refuses it as a tool error when the token is over the limit. */
    take(tokenId: number) {
      const t = now();
      const times = (recent.get(tokenId) ?? []).filter((at) => t - at < 60_000);
      if (times.length >= WRITES_PER_MINUTE) {
        throw new ToolProblem(
          `Too many changes: at most ${WRITES_PER_MINUTE} changes a minute. Wait a minute, then go on.`,
          'Too many requests',
        );
      }
      recent.set(tokenId, [...times, t]);
    },
    record(row: {
      userId: number;
      tokenId: number;
      tool: string;
      outcome: string;
      target: string | null;
      args: object;
    }) {
      // The driver's own data on their own server, like the overwrite log; capped at 4 KB.
      const args = JSON.stringify(row.args).slice(0, 4096);
      insert.run({ ...row, at: now(), args });
    },
  };
}
