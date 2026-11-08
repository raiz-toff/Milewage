/** The one reading the app takes from `expo-file-system`: free bytes on internal storage. */
export interface DiskSpace {
  readonly availableDiskSpace: number;
}

/** SDK 58's `Paths` class (the current API; the old `getFreeDiskStorageAsync` export throws). */
const loadPaths = (): DiskSpace =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('expo-file-system') as typeof import('expo-file-system')).Paths;

/**
 * Free device storage in bytes for the low-storage banner (15 section 3.4). Any failure (no native
 * module, a throwing getter, a value that is not a byte count) is `null`, which the banner treats
 * as "unknown", never as "normal" or "low". Loaded on first use, so tests never touch the module.
 */
export function createFreeBytes(load: () => DiskSpace = loadPaths): () => Promise<number | null> {
  return async () => {
    try {
      const n = load().availableDiskSpace;
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  };
}
