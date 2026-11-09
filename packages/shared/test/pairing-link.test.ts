import { describe, expect, test } from 'vitest';
import { pairingLinks, parsePairingLink, type PairingLink } from '../src/index';

const TOKEN = `mwp_${'a'.repeat(43)}`;
const AWAY = 'https://box.tail1234.ts.net';
const HOME = 'http://192.168.1.20:8080';
const enc = encodeURIComponent;

describe('pairingLinks', () => {
  test('writes the app link and the page link, with h when the home address differs', () => {
    expect(pairingLinks({ baseUrl: AWAY, token: TOKEN, homeUrl: HOME })).toEqual({
      appLink: `milewage://pair?v=1&u=${enc(AWAY)}&t=${TOKEN}&h=${enc(HOME)}`,
      pageUrl: `${AWAY}/pair#v=1&t=${TOKEN}&h=${enc(HOME)}`,
    });
  });

  test('leaves h out when there is no home address or it is the address in the code', () => {
    const plain = {
      appLink: `milewage://pair?v=1&u=${enc(HOME)}&t=${TOKEN}`,
      pageUrl: `${HOME}/pair#v=1&t=${TOKEN}`,
    };
    expect(pairingLinks({ baseUrl: HOME, token: TOKEN })).toEqual(plain);
    expect(pairingLinks({ baseUrl: HOME, token: TOKEN, homeUrl: `${HOME}/` })).toEqual(plain);
  });

  test('trims trailing slashes and keeps a path', () => {
    expect(pairingLinks({ baseUrl: 'https://a.b:8443/mw/', token: TOKEN }).pageUrl).toBe(
      `https://a.b:8443/mw/pair#v=1&t=${TOKEN}`,
    );
  });
});

describe('round trips', () => {
  const links: PairingLink[] = [
    { baseUrl: AWAY, token: TOKEN },
    { baseUrl: AWAY, token: TOKEN, homeUrl: HOME },
    { baseUrl: AWAY, token: TOKEN, homeUrl: 'http://milewage.local' },
    { baseUrl: 'https://a.b:8443/mw', token: TOKEN, homeUrl: 'http://[fd00::5]:8080' },
    { baseUrl: HOME, token: `mwp_${'-_9Zz'.repeat(9)}` },
    { baseUrl: 'http://milewage.home.arpa/sub/dir', token: 'mwp_0123456789' },
  ];
  test.each(links)('both forms read back as what was written: %o', (link) => {
    const { appLink, pageUrl } = pairingLinks(link);
    expect(parsePairingLink(appLink)).toEqual(link);
    expect(parsePairingLink(pageUrl)).toEqual(link);
  });

  test('the page link, read on the page, gives the app link the server wrote (h kept)', () => {
    const written = pairingLinks({ baseUrl: AWAY, token: TOKEN, homeUrl: HOME });
    expect(pairingLinks(parsePairingLink(written.pageUrl)!).appLink).toBe(written.appLink);
  });
});

describe('parsePairingLink', () => {
  test('trims a trailing slash on u and surrounding white space', () => {
    expect(
      parsePairingLink(`  milewage://pair?v=1&u=${enc('https://a.b:8443/mw/')}&t=${TOKEN}\n`),
    ).toEqual({
      baseUrl: 'https://a.b:8443/mw',
      token: TOKEN,
    });
  });

  test('the page form takes its base from the page, never from a smuggled u', () => {
    const base = { baseUrl: AWAY, token: TOKEN };
    expect(parsePairingLink(`${AWAY}/pair#v=1&t=${TOKEN}`)).toEqual(base);
    expect(parsePairingLink(`${AWAY}/pair/#v=1&t=${TOKEN}`)).toEqual(base);
    expect(
      parsePairingLink(`${AWAY}/pair#v=1&t=${TOKEN}&u=${enc('https://evil.example')}`),
    ).toEqual(base);
    expect(parsePairingLink(`https://a.b/mw/pair#v=1&t=${TOKEN}`)?.baseUrl).toBe('https://a.b/mw');
  });

  test('an h that is not a home address is dropped, the rest of the code kept', () => {
    for (const h of [
      'http://evil.example.com',
      'https://box.tail1234.ts.net',
      'http://localhost',
      'ftp://192.168.1.2',
      '',
    ]) {
      expect(parsePairingLink(`milewage://pair?v=1&u=${enc(AWAY)}&t=${TOKEN}&h=${enc(h)}`)).toEqual(
        {
          baseUrl: AWAY,
          token: TOKEN,
        },
      );
    }
  });

  test.each([
    '',
    'https://example.com',
    'milewage://pair',
    `milewage://pair?`,
    `https://a.b/pair?v=1&t=${TOKEN}`,
    `https://a.b/pairing#v=1&t=${TOKEN}`,
    `https://a.b/pair#v=2&t=${TOKEN}`,
    `https://a.b/pair#t=${TOKEN}`,
    `ftp://a.b/pair#v=1&t=${TOKEN}`,
    `milewage://pair?v=2&u=${enc('https://a.b')}&t=${TOKEN}`,
    `milewage://pair?u=${enc('https://a.b')}&t=${TOKEN}`,
    `milewage://pair?v=1&u=${enc('ftp://a.b')}&t=${TOKEN}`,
    `milewage://pair?v=1&u=${enc('https://a b')}&t=${TOKEN}`,
    `milewage://pair?v=1&u=${enc('https://a.b?x=1')}&t=${TOKEN}`,
    `milewage://pair?v=1&u=&t=${TOKEN}`,
    'milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwd_short',
    'milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwp_short',
    `milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwd_${'a'.repeat(43)}`,
    `milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwp_${'a'.repeat(40)}%2B`,
    'milewage://pair?v=1&u=https%3A%2F%2Fa.b',
    `milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=${TOKEN}&broken`,
    'milewage://pair?v=1&u=%E0%A4%A&t=x',
    `other://pair?v=1&u=https%3A%2F%2Fa.b&t=${TOKEN}`,
  ])('rejects %j', (text) => {
    expect(parsePairingLink(text)).toBeNull();
  });
});
