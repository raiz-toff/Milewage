// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_PLATFORMS } from '@milewage/shared';
import {
  contrast,
  CUSTOM_COLORS,
  customColor,
  inkOn,
  initialsOf,
  PlatformBadge,
  platformLook,
  PlatformName,
} from '../src/platforms/PlatformBadge';

afterEach(cleanup);

const doordash = { slug: 'doordash', label: 'DoorDash' };

describe('platform badge (plan 25)', () => {
  it('shows initials on the brand colour; MileWage ships no platform logo', () => {
    expect(platformLook(doordash)).toMatchObject({ kind: 'initials', text: 'DD', bg: '#FF3008' });
    expect(platformLook({ slug: 'amazonflex', label: 'Amazon Flex' })).toMatchObject({
      kind: 'initials',
      text: 'AF',
      bg: '#232F3E',
      fg: '#FFFFFF',
    });
    expect(platformLook({ slug: 'other', label: 'Other' })).toMatchObject({ bg: null });
  });

  it('shows initials for every built-in platform', () => {
    for (const p of BUILTIN_PLATFORMS) {
      expect(platformLook(p), p.slug).toMatchObject({ kind: 'initials', text: p.initials });
    }
  });

  it("uses a custom platform's own colour, else a stable one from its slug", () => {
    expect(platformLook({ slug: 'mine', label: 'Mine', color: '#123456' })).toMatchObject({
      kind: 'initials',
      text: 'M',
      bg: '#123456',
      fg: '#FFFFFF',
    });
    const spark = platformLook({ slug: 'spark_driver', label: 'Spark Driver', color: null });
    expect(spark).toMatchObject({ kind: 'initials', text: 'SD' });
    expect(CUSTOM_COLORS).toContain(spark.bg);
    expect(customColor('spark_driver')).toBe(spark.bg);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(customColor)).size).toBeGreaterThan(1);
    // The driver's colour wins over a built-in's brand colour; an emoji replaces the letters.
    expect(platformLook({ ...doordash, color: '#000000', emoji: '🚗' })).toMatchObject({
      kind: 'emoji',
      text: '🚗',
      bg: '#000000',
    });
    expect(initialsOf('  lyft ')).toBe('L');
  });

  it('keeps letters and marks at 4.5:1 or more on every built-in and fallback colour', () => {
    const colours = [
      ...BUILTIN_PLATFORMS.flatMap((p) => (p.color ? [p.color] : [])),
      ...CUSTOM_COLORS,
    ];
    for (const c of colours) expect(contrast(c, inkOn(c)), c).toBeGreaterThanOrEqual(4.5);
  });

  it('is hidden next to the name and named when it stands alone', () => {
    render(<PlatformName platform={doordash} />);
    expect(screen.getByText('DoorDash')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    cleanup();
    render(<PlatformBadge platform={doordash} labelled size="md" />);
    const badge = screen.getByRole('img', { name: 'DoorDash' });
    expect(badge.getAttribute('data-look')).toBe('initials');
    expect(badge.textContent).toBe('DD');
  });
});
