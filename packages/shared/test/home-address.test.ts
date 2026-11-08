import { expect, test } from 'vitest';
import { addressParts, httpAllowed, isHomeAddress, isHomeHost } from '../src/home-address';

test('home hosts: private IPv4, link-local, IPv6 unique local and link-local, home names', () => {
  const home = [
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '169.254.10.20',
    'fd12:3456:789a::1',
    'fc00::1',
    'fe80::1',
    'fe80::1%wlan0',
    '[fd00::5]',
    '::ffff:192.168.1.20',
    'milewage.local',
    'MileWage-Box.Local',
    'milewage.local.',
    'box.lan',
    'server.home.arpa',
  ];
  for (const h of home) expect([h, isHomeHost(h)]).toEqual([h, true]);
});

test('not home: loopback, public, Tailscale, the edges of the ranges, odd names', () => {
  const away = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '11.0.0.1',
    '100.100.1.2', // Tailscale CGNAT: reached through https://…ts.net instead
    'box.tail1234.ts.net',
    'example.com',
    'local',
    'evil.local.example.com',
    'lan',
    'fec0::1',
    '2001:db8::1',
    '256.1.1.1',
    '10.0.0',
    'bad host.local',
    '',
  ];
  for (const h of away) expect([h, isHomeHost(h)]).toEqual([h, false]);
});

test('addresses: http only to a home address, https everywhere', () => {
  expect(httpAllowed('http://192.168.1.20:8080')).toBe(true);
  expect(httpAllowed('http://[fd00::5]:8080/')).toBe(true);
  expect(httpAllowed('http://milewage.local')).toBe(true);
  expect(httpAllowed('https://box.tail1234.ts.net')).toBe(true);
  expect(httpAllowed('https://192.168.1.20')).toBe(true);
  expect(httpAllowed('http://box.tail1234.ts.net')).toBe(false);
  expect(httpAllowed('http://8.8.8.8')).toBe(false);
  expect(httpAllowed('http://localhost:5173')).toBe(false);
  // user information cannot hide the real host
  expect(httpAllowed('http://192.168.1.20@example.com/')).toBe(false);
  expect(httpAllowed('ftp://192.168.1.20')).toBe(false);
  expect(httpAllowed('not an address')).toBe(false);
  expect(isHomeAddress('HTTP://192.168.1.20')).toBe(true);
  expect(isHomeAddress('https://example.com')).toBe(false);
  expect(addressParts('https://[FD00::5]:443/x')).toEqual({ scheme: 'https', host: 'fd00::5' });
});
