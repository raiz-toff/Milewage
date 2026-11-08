import { describe, expect, it } from 'vitest';
import { addressProblem } from '../src/pairing/address';

describe('addressProblem (plan 19 section 3.3, plan 28)', () => {
  it.each([
    ['https://mybox.tail1234.ts.net', null],
    ['https://mw.example.com', null],
    ['http://localhost:5173', 'local'],
    ['https://app.localhost', 'local'],
    ['http://127.0.0.1:8080', 'local'],
    ['http://[::1]:8080', 'local'],
    // Home addresses are fine, http or https (plan 28).
    ['http://milewage.lan', null],
    ['http://192.168.1.20:8080', null],
    ['https://192.168.1.20', null],
    ['http://[fd12::1]:8080', null],
    ['http://box.local', null],
    // Plain http anywhere else, and a bare public address over https, are not.
    ['http://box.example.com', 'http'],
    ['http://8.8.8.8:8080', 'http'],
    ['https://8.8.8.8', 'ip'],
    ['https://[2001:db8::1]', 'ip'],
    ['not a url', null],
  ])('%s → %s', (address, problem) => {
    expect(addressProblem(address)).toBe(problem);
  });
});
