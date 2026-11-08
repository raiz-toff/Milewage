import { describe, expect, it } from 'vitest';
import { addressProblem } from '../src/pairing/address';

describe('addressProblem (plan 19 section 3.3)', () => {
  it.each([
    ['https://mybox.tail1234.ts.net', null],
    ['https://mw.example.com', null],
    ['http://localhost:5173', 'local'],
    ['https://app.localhost', 'local'],
    ['http://127.0.0.1:8080', 'local'],
    ['http://[::1]:8080', 'local'],
    ['http://milewage.lan', 'http'],
    ['http://192.168.1.20:8080', 'http'],
    ['https://192.168.1.20', 'ip'],
    ['https://[fd7a:115c:a1e0::1]', 'ip'],
    ['not a url', null],
  ])('%s → %s', (address, problem) => {
    expect(addressProblem(address)).toBe(problem);
  });
});
