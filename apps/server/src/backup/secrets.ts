import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ageCodec } from './age';
import { BackupError, type BackupCodec } from './engine';

/**
 * `config/secrets.json` (10 section 2): holds only the age *public* key. `key_tail_check` is a hash
 * of the last 6 characters of the recovery key, there only until the driver confirms them.
 */
export interface Secrets {
  age_public_key: string;
  key_tail_check?: string;
}

export interface SecretsStore {
  read(): Secrets | undefined;
  write(secrets: Secrets): void;
}

export function fileSecrets(configDir: string): SecretsStore {
  const path = join(configDir, 'secrets.json');
  return {
    read() {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Secrets;
        return typeof parsed.age_public_key === 'string' ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    write(secrets) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, path);
    },
  };
}

/**
 * The codec backups use: always age, to the configured public key. With no key a backup fails
 * loudly; a plain file is never written (location history must not be readable, 10 section 4).
 */
export const secretsCodec = (store: SecretsStore) => (): BackupCodec => {
  const key = store.read()?.age_public_key;
  if (!key) throw new BackupError('no_key', 'No backup encryption key is configured.');
  return ageCodec(key);
};
