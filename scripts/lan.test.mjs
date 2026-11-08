import { expect, test } from 'vitest';
import { devLan, homeIPv4 } from './lan.mjs';

const ifaces = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  docker0: [{ address: '100.100.1.2', family: 'IPv4', internal: false }],
  eth0: [
    { address: 'fe80::1', family: 'IPv6', internal: false },
    { address: '192.168.1.20', family: 'IPv4', internal: false },
  ],
};

test('the first private IPv4 address, never loopback or a public one', () => {
  expect(homeIPv4(ifaces)).toBe('192.168.1.20');
  expect(homeIPv4({ lo: ifaces.lo, docker0: ifaces.docker0 })).toBeNull();
  expect(homeIPv4({ e: [{ address: '172.20.0.5', family: 4, internal: false }] })).toBe(
    '172.20.0.5',
  );
});

test('only with --host, on the Vite port, and not with MILEWAGE_LAN_DISCOVERY=0', () => {
  expect(devLan([], {}, ifaces)).toBeNull();
  expect(devLan(['--host'], {}, ifaces)).toEqual({
    port: 5173,
    homeUrl: 'http://192.168.1.20:5173',
  });
  expect(devLan(['--host', '0.0.0.0', '--port', '5180'], {}, ifaces)?.port).toBe(5180);
  expect(devLan(['--host=0.0.0.0', '--port=5181'], {}, ifaces)?.homeUrl).toBe(
    'http://192.168.1.20:5181',
  );
  expect(devLan(['--host'], { MILEWAGE_LAN_DISCOVERY: '0' }, ifaces)).toBeNull();
  expect(devLan(['--host'], {}, { lo: ifaces.lo })).toBeNull();
});
