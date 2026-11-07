import { describe, expect, test } from 'vitest';
import {
  BUILTIN_PLATFORMS,
  countryModules,
  dataProblems,
  offer,
  resolvePlace,
  type CountryModule,
} from '../src';

const slugs = (c: CountryModule, region?: string) =>
  resolvePlace(c, region).data.platforms?.map((p) => p.slug);

describe('platforms slot (plan 21, J2)', () => {
  test('each country lists the platforms it offered before, in the same order', () => {
    const [ca, us, gb] = ['CA', 'US', 'GB'].map((c) => countryModules.get(c)!);
    expect(slugs(ca!)).toEqual(
      'doordash ubereats skipthedishes foodora instacart amazonflex other'.split(' '),
    );
    expect(slugs(us!, 'NY')).toEqual(
      'doordash ubereats instacart amazonflex grubhub other'.split(' '),
    );
    expect(slugs(gb!, 'SCT')).toEqual('ubereats amazonflex deliveroo justeat other'.split(' '));
  });

  test('a region adds a local app or takes one away; unknown slugs are reported', () => {
    // ZZ is a user-assigned ISO code; this country is made up.
    const zz = {
      ...countryModules.get('CA')!,
      code: 'ZZ',
      places: [
        { code: 'ZZ-AD', parent: 'ZZ', name: 'Adds', data: { platforms: offer('grubhub') } },
        {
          code: 'ZZ-RM',
          parent: 'ZZ',
          name: 'Removes',
          data: { platforms: [{ slug: 'foodora', available: false as const }] },
        },
      ],
    };
    expect(slugs(zz, 'AD')?.slice(-2)).toEqual(['other', 'grubhub']);
    expect(slugs(zz, 'RM')).not.toContain('foodora');
    expect(slugs(zz, 'RM')).toHaveLength(6);
    expect(dataProblems({ platforms: offer('nope', 'other', 'other') })).toEqual([
      'platform nope is not in the shared list',
      'platform other listed twice',
    ]);
  });

  test('every shared platform is offered somewhere, and the shared list has no country tags', () => {
    const offered = new Set(countryModules.list().flatMap((c) => slugs(c) ?? []));
    for (const p of BUILTIN_PLATFORMS) expect(offered.has(p.slug), p.slug).toBe(true);
    const allowed = ['color', 'initials', 'label', 'logo', 'slug'];
    for (const p of BUILTIN_PLATFORMS)
      expect(allowed).toEqual(expect.arrayContaining(Object.keys(p)));
  });

  test('every shared platform has a badge colour and one or two letters (plan 25)', () => {
    for (const p of BUILTIN_PLATFORMS) {
      expect(p.color === null || /^#[0-9A-F]{6}$/.test(p.color), p.slug).toBe(true);
      expect([...p.initials].length, p.slug).toBeGreaterThan(0);
      expect([...p.initials].length, p.slug).toBeLessThanOrEqual(2);
    }
    // Marks only where plan 25 section 5 allows them: never Amazon's.
    expect(BUILTIN_PLATFORMS.filter((p) => p.logo).map((p) => p.slug)).toEqual([
      'doordash',
      'ubereats',
      'instacart',
      'deliveroo',
      'justeat',
    ]);
  });
});
