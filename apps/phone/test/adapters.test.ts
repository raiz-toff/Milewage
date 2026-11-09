import { createServices, productionParts } from '../src/services';
import { createFreeBytes } from '../src/storage/freeSpace';
import { LOW_STORAGE_BYTES, STORAGE_TEXT } from '../src/sync/status';
import { makeServices, mockServer } from './support/mock';

const paths = () => jest.requireMock('expo-file-system').Paths as { availableDiskSpace: number };
const MB = 1024 * 1024;

afterEach(() => {
  paths().availableDiskSpace = 64 * 1024 ** 3;
});

describe('free storage (15 section 3.4)', () => {
  it('passes the free bytes of expo-file-system through', async () => {
    paths().availableDiskSpace = 123 * MB;
    await expect(createFreeBytes()()).resolves.toBe(123 * MB);
  });

  it('is null when the reading throws, is missing or is not a byte count', async () => {
    const throwing = createFreeBytes(() => {
      throw new Error('no native module');
    });
    await expect(throwing()).resolves.toBeNull();
    const getterThrows = createFreeBytes(() => ({
      get availableDiskSpace(): number {
        throw new Error('statfs failed');
      },
    }));
    await expect(getterThrows()).resolves.toBeNull();
    for (const bad of [NaN, -1, Infinity, undefined as unknown as number]) {
      await expect(createFreeBytes(() => ({ availableDiskSpace: bad }))()).resolves.toBeNull();
    }
  });

  it('production parts read it, and low storage reaches the banner status', async () => {
    const parts = productionParts();
    expect(parts.freeBytes).toBeDefined();
    paths().availableDiskSpace = 100 * MB;
    await expect(parts.freeBytes!()).resolves.toBe(100 * MB);

    const { services } = makeServices(mockServer({}).fetch, { freeBytes: parts.freeBytes });
    expect(100 * MB).toBeLessThan(LOW_STORAGE_BYTES);
    const s = await services.sender.status();
    expect(s.color).toBe('yellow');
    expect(s.message).toBe(STORAGE_TEXT.low);
  });
});

describe('notifications wiring', () => {
  it('production parts carry a notifications port that is never granted without a backend', async () => {
    const parts = productionParts();
    expect(parts.notifications).toBeDefined();
    await expect(parts.notifications!.granted()).resolves.toBe(false);
    // Doing nothing is the documented behaviour: no throw, no prompt.
    await parts.notifications!.show('x', 't', 'b');
    await parts.notifications!.schedule('x', 1, 't', 'b');
    await parts.notifications!.cancel('x');
  });

  it('createServices exposes the port and the unsynced reminders, a never-granted port by default', async () => {
    const { services } = makeServices(mockServer({}).fetch);
    expect(services.notifications).toBeDefined();
    expect(services.reminders).toBeDefined();
    await expect(services.notifications.granted()).resolves.toBe(false);
    const built = createServices({ ...productionParts(), notifications: services.notifications });
    expect(built.notifications).toBe(services.notifications);
  });
});
