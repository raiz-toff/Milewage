// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_PLATFORMS } from '@milewage/shared';
import {
  contrast,
  CUSTOM_COLORS,
  customColor,
  initialsOf,
  PlatformBadge,
  platformLook,
  PlatformName,
  PRESET_COLORS,
} from '../src/platforms/PlatformBadge';
import { atTone, badgeColours } from '../src/platforms/tones';
import scheme from '../src/theme/m3-scheme.json';

afterEach(cleanup);

const doordash = { slug: 'doordash', label: 'DoorDash' };

describe('platform badge (plan 25)', () => {
  it('shows initials on the brand colour; MileWage ships no platform logo', () => {
    expect(platformLook(doordash)).toMatchObject({
      kind: 'initials',
      text: 'DD',
      color: '#FF3008',
    });
    expect(platformLook({ slug: 'amazonflex', label: 'Amazon Flex' })).toMatchObject({
      kind: 'initials',
      text: 'AF',
      color: '#232F3E',
      tones: { light: { fg: '#ffffff' } },
    });
    expect(platformLook({ slug: 'other', label: 'Other' })).toMatchObject({
      color: null,
      tones: null,
    });
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
      color: '#123456',
      tones: badgeColours('#123456'),
    });
    const spark = platformLook({ slug: 'spark_driver', label: 'Spark Driver', color: null });
    expect(spark).toMatchObject({ kind: 'initials', text: 'SD' });
    expect(CUSTOM_COLORS).toContain(spark.color);
    expect(customColor('spark_driver')).toBe(spark.color);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(customColor)).size).toBeGreaterThan(1);
    // The driver's colour wins over a built-in's brand colour; an emoji replaces the letters.
    expect(platformLook({ ...doordash, color: '#000000', emoji: '🚗' })).toMatchObject({
      kind: 'emoji',
      text: '🚗',
      color: '#000000',
    });
    expect(initialsOf('  lyft ')).toBe('L');
  });

  it('keeps letters at 4.5:1 and the badge at 3:1 on cards, in both themes, for any colour', () => {
    const colours = [
      ...BUILTIN_PLATFORMS.flatMap((p) => (p.color ? [p.color] : [])),
      ...CUSTOM_COLORS,
      ...PRESET_COLORS.map((p) => p.color),
      // Colours a driver might type through the API: white, black, the brand yellow, greys.
      '#ffffff',
      '#000000',
      '#ffc21f',
      '#808080',
      '#00ff00',
      '#0000ff',
    ];
    // The card surfaces of index.css: white in light, surface-container in dark.
    const card = {
      light: scheme.light.surfaceContainerLowest,
      dark: scheme.dark.surfaceContainer,
    };
    for (const c of colours) {
      const tones = badgeColours(c);
      for (const theme of ['light', 'dark'] as const) {
        const { bg, fg } = tones[theme];
        expect(contrast(bg, fg), `${c} ${theme}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(bg, card[theme]), `${c} ${theme} on a card`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('draws a colour at Material tones and keeps its hue', () => {
    // Tone is L*: tone 40 of DoorDash red is still red, darker; tone 100 is white.
    expect(atTone('#ff3008', 100)).toBe('#ffffff');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(atTone('#ff3008', 40).slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(g! + 80);
    expect(r!).toBeGreaterThan(b! + 80);
    // Every preset has a name to read out, and no two share a colour.
    expect(new Set(PRESET_COLORS.map((p) => p.color)).size).toBe(PRESET_COLORS.length);
    for (const p of PRESET_COLORS) expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
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

  it("shows the driver's uploaded logo, and the letters when it does not load", () => {
    const withLogo = { ...doordash, emoji: '🚗', logo_version: 'v1' };
    expect(platformLook(withLogo)).toMatchObject({
      kind: 'image',
      text: '/api/v1/platforms/doordash/logo?v=v1',
    });
    render(<PlatformBadge platform={withLogo} labelled />);
    const badge = screen.getByRole('img', { name: 'DoorDash' });
    const img = badge.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe(''); // the badge carries the name
    fireEvent.error(img);
    expect(badge.querySelector('img')).toBeNull();
    expect(badge.textContent).toBe('🚗');
  });
});
