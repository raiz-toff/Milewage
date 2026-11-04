import type { KeyValueStore } from '../pairing/pairing';

/** The three calls of `expo-secure-store` that the app uses (Android Keystore-backed). */
export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** SecureStore keys may only use letters, digits, `.`, `-` and `_`; anything else becomes `_`. */
export const secureKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * The pairing credential's home. Values are encrypted with a Keystore key that never leaves the
 * phone (the app has `allowBackup=false`, so neither the key nor the value is restored onto
 * another phone). A value the Keystore can no longer decrypt (key invalidated, app data restored
 * from elsewhere) is treated as absent and deleted: the driver pairs again, nothing is guessed.
 */
export class SecureKeyValueStore implements KeyValueStore {
  /** Keys whose value could not be read and was discarded; for diagnostics and the UI. */
  readonly unreadable: string[] = [];

  constructor(private readonly backend: SecureBackend) {}

  async get(key: string): Promise<string | null> {
    const k = secureKey(key);
    try {
      return await this.backend.getItemAsync(k);
    } catch {
      this.unreadable.push(key);
      try {
        await this.backend.deleteItemAsync(k);
      } catch {
        /* nothing more to do */
      }
      return null;
    }
  }

  set(key: string, value: string): Promise<void> {
    return this.backend.setItemAsync(secureKey(key), value);
  }

  remove(key: string): Promise<void> {
    return this.backend.deleteItemAsync(secureKey(key));
  }
}

/** Loads the native module on first use, so tests and non-Android builds never touch it. */
export function createExpoSecureBackend(): SecureBackend {
  const load = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-secure-store') as typeof import('expo-secure-store');
  return {
    getItemAsync: (k) => load().getItemAsync(k),
    setItemAsync: (k, v) => load().setItemAsync(k, v),
    deleteItemAsync: (k) => load().deleteItemAsync(k),
  };
}
