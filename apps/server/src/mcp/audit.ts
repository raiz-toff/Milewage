import type { ModuleJob } from '@milewage/shared';
import type { Db } from '../db';
import { ToolProblem } from './tools';

/** Changes one token may make per minute (plan 26 section 3.7), on top of the request limit. */
export const WRITES_PER_MINUTE = 30;

const DAY = 24 * 60 * 60 * 1000;
/** How long an audit row is kept (plan 26 section 3.7): a year, then the daily housekeeping drops it. */
export const AUDIT_KEPT_MS = 365 * DAY;

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

/**
 * The audit retention (plan 26 Q6): drops `mcp_audit` rows older than `AUDIT_KEPT_MS`. Like the
 * route archive, a first pass runs a minute after start (so a server restarted every day still
 * prunes) and then one each `everyMs`. The statement is prepared on each pass: in read-only mode
 * after a skipped upgrade the table may not exist yet, and that must not stop the server.
 */
export function createAuditPrune(
  db: Db,
  now: () => number,
  everyMs = DAY,
  log?: (message: string, fields?: object) => void,
) {
  /** One pass. Returns the number of rows dropped. */
  const prune = () =>
    db.prepare('DELETE FROM mcp_audit WHERE at < ?').run(now() - AUDIT_KEPT_MS).changes;
  const run = () => {
    try {
      const rows = prune();
      if (rows > 0) log?.('mcp audit pruned', { rows });
    } catch (e) {
      // housekeeping must never take the server down
      log?.('mcp audit prune failed', { error: (e as Error).message });
    }
  };
  const job: ModuleJob = {
    name: 'mcp-audit-prune',
    start() {
      const first = setTimeout(run, Math.min(60_000, everyMs));
      const timer = setInterval(run, everyMs);
      first.unref();
      timer.unref();
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    },
  };
  return { prune, job };
}
