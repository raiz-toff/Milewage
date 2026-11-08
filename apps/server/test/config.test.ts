import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';

const noConfig = { MILEWAGE_CONFIG_DIR: join(tmpdir(), 'mw-no-such-config') };

describe('backup folder', () => {
  test('with no setting it sits next to the data folder', () => {
    expect(loadConfig(noConfig)).toMatchObject({ dataDir: 'data', backupDir: 'backups' });
    expect(loadConfig({ ...noConfig, MILEWAGE_DATA_DIR: '/app/data' }).backupDir).toBe(
      '/app/backups',
    );
  });

  test('a server given only a data folder never writes backups into the folder it started in', () => {
    const base = join(tmpdir(), 'mw-run');
    const config = loadConfig({ ...noConfig, MILEWAGE_DATA_DIR: join(base, 'data') });
    expect(config.backupDir).toBe(join(base, 'backups'));
  });

  test('MILEWAGE_BACKUP_DIR wins', () => {
    const config = loadConfig({
      ...noConfig,
      MILEWAGE_DATA_DIR: '/app/data',
      MILEWAGE_BACKUP_DIR: '/mnt/nas/milewage',
    });
    expect(config.backupDir).toBe('/mnt/nas/milewage');
  });
});
