import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { resetPasswordCommand } from './cli-password';
import { restoreCommand, type RestoreIo } from './cli-restore';
import { recalcReport, type RecalcRow } from './processing/recalc-report';

export type CliIo = RestoreIo;

const USAGE = `Usage: milewage-cli <command>

Commands:
  recalc --dry-run [--since YYYY-MM-DD] [--json]
      Compare what the current algorithm gives each ended or finalized shift with what is stored.
      Prints the differences and changes nothing. Applying a new algorithm to a shift is done per shift
      (POST /api/v1/shifts/<id>/recalculate; the web app has no control for it); a finalized shift is
      never changed automatically.

  restore --file <backup.db.gz.age> [--key <recovery key> | --key @<file holding it>] [--yes]
      Run with the api service stopped. Checks the backup, moves the current data into
      <data>/before-restore-<time>/ (nothing is deleted) and writes the backup's data in its place.
      Without --key it asks for the key; without --yes it asks before changing anything.

  reset-password [--username <name>]
      Run with the api service stopped. Gives the account a new random password, prints it once
      and signs out every browser. Paired phones keep working. --username is needed only
      when the server has more than one account.

Environment: MILEWAGE_DATA_DIR (default /app/data) holds milewage.db; MILEWAGE_CONFIG_DIR
(default /app/config) holds secrets.json.
`;

const pad = (v: string | number | null, n: number) => String(v ?? '-').padStart(n);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function table(rows: readonly RecalcRow[]): string[] {
  const lines = [
    `${pad('Shift', 6)} ${'Date'.padEnd(10)} ${'Status'.padEnd(9)} ${pad('Calc', 9)} ${pad('Old m', 9)} ${pad('New m', 9)} ${pad('Diff', 7)} ${pad('Active', 7)} ${pad('Deadhd', 7)} ${pad('Personal', 8)}`,
  ];
  for (const r of rows) {
    const calc = r.skipped ? '-' : `${r.oldCalcVersion ?? '-'}>${r.newCalcVersion}`;
    if (!r.diff || !r.old || !r.next) {
      lines.push(
        `${pad(r.shiftId, 6)} ${r.localDate.padEnd(10)} ${r.status.padEnd(9)} ${pad(calc, 9)} skipped: ${r.skipped === 'raw_points_archived' ? 'raw points were archived' : 'no stored result'}`,
      );
      continue;
    }
    lines.push(
      `${pad(r.shiftId, 6)} ${r.localDate.padEnd(10)} ${r.status.padEnd(9)} ${pad(calc, 9)} ${pad(r.old.totalM, 9)} ${pad(r.next.totalM, 9)} ${pad(signed(r.diff.totalM), 7)} ${pad(signed(r.diff.activeM), 7)} ${pad(signed(r.diff.deadheadM), 7)} ${pad(signed(r.diff.personalM), 8)}`,
    );
  }
  return lines;
}

const RESTORE_FLAGS = new Set(['--file', '--key', '--yes']);

/** `restore` options: `--file x` or `--file=x`, `--key x` or `--key=x`, `--yes`. */
function restoreArgs(
  args: readonly string[],
): { file?: string; key?: string; yes: boolean } | string {
  const out: { file?: string; key?: string; yes: boolean } = { yes: false };
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (!RESTORE_FLAGS.has(name)) return `Unknown option ${args[i]}.`;
    if (name === '--yes') {
      out.yes = true;
      continue;
    }
    const value = inline ?? args[++i];
    if (!value) return `${name} needs a value.`;
    out[name === '--file' ? 'file' : 'key'] = value;
  }
  return out;
}

/** `milewage-cli` (10 section 7, 14 section 11). Resolves to the exit code: 0 ok, 1 failed, 2 usage. */
export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
): Promise<number> {
  if (argv[0] === 'reset-password') return resetPasswordCommand(argv.slice(1), env, io);
  if (argv[0] !== 'restore') return recalc(argv, env, io);
  const opts = restoreArgs(argv.slice(1));
  if (typeof opts === 'string') {
    io.err(`${opts}\n${USAGE}`);
    return 2;
  }
  return restoreCommand(opts, env, io);
}

function recalc(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
): number {
  const [command, ...args] = argv;
  if (command !== 'recalc') {
    io.err(USAGE);
    return command === undefined || command === 'help' || command === '--help' ? 0 : 2;
  }
  const flags = new Set(args.filter((a) => a.startsWith('--') && !a.startsWith('--since')));
  const sinceArg = args.find((a) => a.startsWith('--since'));
  let since: string | undefined;
  if (sinceArg) {
    const value = sinceArg.includes('=')
      ? sinceArg.split('=')[1]
      : args[args.indexOf(sinceArg) + 1];
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      io.err('--since needs a date like 2026-01-31.');
      return 2;
    }
    since = value;
  }
  for (const f of flags) {
    if (f !== '--dry-run' && f !== '--json') {
      io.err(`Unknown option ${f}.\n${USAGE}`);
      return 2;
    }
  }
  if (!flags.has('--dry-run')) {
    io.err(
      'recalc only produces a comparison report: pass --dry-run. A finalized shift is never recomputed automatically (14 section 11).',
    );
    return 2;
  }
  const file = join(env.MILEWAGE_DATA_DIR ?? '/app/data', 'milewage.db');
  if (!existsSync(file)) {
    io.err(`No database at ${file}.`);
    return 1;
  }
  // Read-only: a second writing connection must never exist while the server runs (10 section 3.1).
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const rows = recalcReport(db, { since });
    const compared = rows.filter((r) => !r.skipped);
    const differ = compared.filter((r) => r.changed);
    if (flags.has('--json')) {
      io.out(JSON.stringify({ since: since ?? null, changed_nothing: true, shifts: rows }));
      return 0;
    }
    for (const line of table(rows)) io.out(line);
    io.out(
      `${compared.length} shifts compared, ${differ.length} differ, ${rows.length - compared.length} skipped. Nothing was changed.`,
    );
    return 0;
  } catch (e) {
    io.err(`recalc failed: ${(e as Error).message}`);
    return 1;
  } finally {
    db.close();
  }
}
