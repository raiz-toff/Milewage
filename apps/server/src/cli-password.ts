import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from './auth/password';
import { liveGeneration, Refused, type RestoreIo } from './cli-restore';

/** 16 base64url characters: 96 random bits, typed once and then changed in Settings. */
const newPassword = () => randomBytes(12).toString('base64url');

/**
 * `milewage-cli reset-password [--username <name>]`, run with the API stopped, like `restore`.
 * Gives the account a new random password, prints it once and signs out every browser. Paired
 * phones keep working: they have their own codes. The username is only needed when the server has
 * more than one account. Returns 0, 1 (failed) or 2 (usage).
 */
export async function resetPasswordCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: RestoreIo,
): Promise<number> {
  let username: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (name !== '--username') {
      io.err(`Unknown option ${args[i]}.`);
      return 2;
    }
    username = inline ?? args[++i];
    if (!username) {
      io.err('--username needs a value.');
      return 2;
    }
  }
  const file = join(env.MILEWAGE_DATA_DIR ?? '/app/data', 'milewage.db');
  if (!existsSync(file)) {
    io.err(`No database at ${file}.`);
    return 1;
  }
  try {
    liveGeneration(file); // refuses while the server runs: only one process writes (10 section 3.1)
  } catch (e) {
    io.err((e as Error).message);
    return 1;
  }
  const db = new Database(file, { fileMustExist: true, timeout: 500 });
  try {
    const users = db.prepare('SELECT id, username FROM users ORDER BY id').all() as {
      id: number;
      username: string;
    }[];
    const user =
      username === undefined
        ? users.length === 1
          ? users[0]
          : undefined
        : users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      if (users.length === 0)
        throw new Refused(
          'This server has no account yet. Open MileWage in a browser to set it up.',
        );
      throw new Refused(
        username === undefined
          ? `This server has ${users.length} accounts. Add --username with one of: ${users.map((u) => u.username).join(', ')}.`
          : `No account is called ${username}.`,
      );
    }
    const password = newPassword();
    const hash = await hashPassword(password);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(user.id);
    })();
    io.out(`New password for ${user.username}: ${password}`);
    io.out(
      'Start the api service, sign in with it, then change it in Settings > Account and security.',
    );
    io.out('Every browser was signed out. Paired phones keep working.');
    return 0;
  } catch (e) {
    io.err(e instanceof Refused ? e.message : `reset-password failed: ${(e as Error).message}`);
    return 1;
  } finally {
    db.close();
  }
}
