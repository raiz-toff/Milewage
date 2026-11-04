import { Pairing } from '../src/pairing/pairing';
import {
  createExpoSecureBackend,
  SecureKeyValueStore,
  secureKey,
} from '../src/storage/secureStore';
import type { SecureBackend } from '../src/storage/secureStore';
import { MemoryStore } from '../src/pairing/pairing';
import { DEVICE_TOKEN, json, mockServer, SETTINGS } from './support/mock';

/** Stands in for the Keystore: refuses keys SecureStore refuses, can lose its key. */
class FakeKeystore implements SecureBackend {
  data = new Map<string, string>();
  broken = false;
  async getItemAsync(k: string) {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error('invalid key');
    if (this.broken) throw new Error('KeyPermanentlyInvalidated');
    return this.data.get(k) ?? null;
  }
  async setItemAsync(k: string, v: string) {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error('invalid key');
    this.data.set(k, v);
  }
  async deleteItemAsync(k: string) {
    this.data.delete(k);
  }
}

const server_ = () =>
  mockServer({
    'POST /pairing/redeem': () =>
      json(200, { device_id: 7, device_token: DEVICE_TOKEN, settings: SETTINGS }),
  });

describe('SecureKeyValueStore', () => {
  it('round-trips and removes values', async () => {
    const s = new SecureKeyValueStore(new FakeKeystore());
    await s.set('pairing.credential', '{"a":1}');
    expect(await s.get('pairing.credential')).toBe('{"a":1}');
    await s.remove('pairing.credential');
    expect(await s.get('pairing.credential')).toBeNull();
  });

  it('maps keys the Keystore wrapper would refuse', async () => {
    expect(secureKey('a:b/c d')).toBe('a_b_c_d');
    const s = new SecureKeyValueStore(new FakeKeystore());
    await s.set('a:b', 'x');
    expect(await s.get('a:b')).toBe('x');
  });

  it('treats an undecryptable value as absent, deletes it and says so', async () => {
    const ks = new FakeKeystore();
    const s = new SecureKeyValueStore(ks);
    await s.set('pairing.credential', 'x');
    ks.broken = true;
    expect(await s.get('pairing.credential')).toBeNull();
    expect(s.unreadable).toEqual(['pairing.credential']);
    ks.broken = false;
    expect(ks.data.size).toBe(0);
  });

  it('the credential survives a restart: a new Pairing over the same keystore is still paired', async () => {
    const ks = new FakeKeystore();
    const server = server_();
    const first = new Pairing({
      secure: new SecureKeyValueStore(ks),
      plain: new MemoryStore(),
      fetch: server.fetch,
    });
    await first.redeem({ baseUrl: 'http://x', token: 'mwp_abcdefghijklmnop' });
    const after = new Pairing({
      secure: new SecureKeyValueStore(ks),
      plain: new MemoryStore(),
      fetch: server.fetch,
    });
    const state = await after.load();
    expect(state?.credential.deviceToken).toMatch(/^mwd_/);
    // and the token is stored only in the secure store
    expect([...ks.data.keys()]).toEqual(['pairing.credential']);
    await after.unpair();
    expect(await after.load()).toBeNull();
  });

  it('a lost Keystore key means not paired (re-pair), not a crash', async () => {
    const ks = new FakeKeystore();
    const server = server_();
    const p = new Pairing({
      secure: new SecureKeyValueStore(ks),
      plain: new MemoryStore(),
      fetch: server.fetch,
    });
    await p.redeem({ baseUrl: 'http://x', token: 'mwp_abcdefghijklmnop' });
    ks.broken = true;
    expect(await p.load()).toBeNull();
    expect(await p.session()).toBeNull();
  });

  it('the Expo backend is loaded only when first used', () => {
    expect(() => createExpoSecureBackend()).not.toThrow();
  });
});
