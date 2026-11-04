import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

type Scrypt = (password: string, salt: Buffer, length: number, options: object) => Promise<Buffer>;
const scrypt = promisify(scryptCb) as Scrypt;
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const derive = (password: string, salt: Buffer) =>
  scrypt(password.normalize('NFKC'), salt, 32, PARAMS);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'));
  return key.length === expected.length && timingSafeEqual(key, expected);
}
