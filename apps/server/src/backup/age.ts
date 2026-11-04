import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { BackupCodec } from './engine';

// age-encryption is pre-1.0 and pinned to an exact version in package.json (10 section 4). Plain
// X25519 identities only, so the standard Go `age` and `rage` tools open our files (B14).

export interface RecoveryKey {
  /** `AGE-SECRET-KEY-1...`: shown to the driver once, never stored on the server. */
  identity: string;
  /** `age1...`: kept in config/secrets.json. */
  recipient: string;
}

export async function generateRecoveryKey(): Promise<RecoveryKey> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/** The last 6 characters the driver types back at setup, upper-cased (10 section 4). */
export const keyTail = (identity: string) => identity.trim().slice(-6).toUpperCase();
/** What the server keeps to check that tail: a hash, not the characters. */
export const tailCheck = (tail: string) =>
  createHash('sha256').update(`milewage-key-tail:${tail.trim().toUpperCase()}`).digest('hex');

/** Throws if `identity` is not a well-formed age X25519 secret key. Returns its recipient. */
export async function recipientOf(identity: string): Promise<string> {
  if (!/^AGE-SECRET-KEY-1[A-Z0-9]{50,}$/i.test(identity.trim())) {
    throw new Error('Not an age secret key.');
  }
  return identityToRecipient(identity.trim().toUpperCase());
}

/** Encrypts the gzip stream to one recipient; files are named `*.db.gz.age`. */
export const ageCodec = (recipient: string): BackupCodec => ({
  suffix: '.db.gz.age',
  async wrap(gzipped) {
    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const sealed = await encrypter.encrypt(Readable.toWeb(gzipped) as ReadableStream<Uint8Array>);
    return Readable.fromWeb(sealed as never);
  },
});

/** Decrypts an age stream; rejects (when read) if the identity does not match the file. */
export async function decryptStream(source: Readable, identity: string): Promise<Readable> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity.trim().toUpperCase());
  const plain = await decrypter.decrypt(Readable.toWeb(source) as ReadableStream<Uint8Array>);
  return Readable.fromWeb(plain as never);
}
