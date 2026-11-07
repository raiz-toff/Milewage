import type { AppSqlDb } from '../db/appDb';

/**
 * Identity checks on every answer (15 section 9.3, 9.4). A different `X-MileWage-Instance` than the
 * one stored at pairing means the address now points at another server: all requests stop and all
 * data stays. A higher `X-MileWage-Restore-Gen` means the server was restored from a backup: the
 * shifts the phone thought were safe are marked "on phone only" again and eviction is blocked.
 * An answer without the headers (captive portal, proxy page) is not a wrong server.
 */
export class ConnectionMonitor {
  wrongServer = false;
  restored = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly db: AppSqlDb) {}

  blocked = (): boolean => this.wrongServer;

  observe = (headers: Headers, expectedInstance: string | null): void => {
    const instance = headers.get('X-MileWage-Instance');
    if (!instance) return;
    if (expectedInstance && instance !== expectedInstance) {
      this.wrongServer = true;
      return;
    }
    const gen = Number(headers.get('X-MileWage-Restore-Gen'));
    if (Number.isFinite(gen) && headers.get('X-MileWage-Restore-Gen') !== null) {
      this.chain = this.chain.then(() => this.checkGeneration(gen)).catch(() => undefined);
    }
  };

  /** The driver checked the address or re-paired. */
  clearWrongServer(): void {
    this.wrongServer = false;
  }

  acknowledgeRestore(): void {
    this.restored = false;
  }

  /** Resolves when the generation checks queued so far are done (tests, shutdown). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async checkGeneration(gen: number): Promise<void> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_state WHERE key = 'restore_gen'",
    );
    const stored = row ? Number(row.value) : null;
    if (stored === null || gen > stored) {
      await this.db.runAsync(
        "INSERT INTO sync_state (key, value) VALUES ('restore_gen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        String(gen),
      );
    }
    if (stored !== null && gen > stored) {
      this.restored = true;
      await this.db.runAsync(
        "UPDATE shifts SET sync_state = 'local', server_deduction_known = 0 WHERE sync_state = 'on_server'",
      );
    }
  }
}
