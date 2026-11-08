// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogoMark } from '../src/components/logo';

describe('LogoMark follows the theme like the tab icon (B2)', () => {
  it('Asphalt coin with a yellow road on light pages, the yellow coin on dark ones', () => {
    const { container } = render(<LogoMark />);
    const coin = container.querySelector('circle:not(clipPath circle)')!;
    const [road, dashes] = [...container.querySelectorAll('g path')];
    expect(coin.getAttribute('class')).toBe('fill-[#101214] dark:fill-[#FFC21F]');
    expect(road!.getAttribute('class')).toBe('stroke-[#FFC21F] dark:stroke-[#101214]');
    expect(dashes!.getAttribute('class')).toBe('stroke-[#101214] dark:stroke-[#FFC21F]');
    expect(coin.getAttribute('fill')).toBeNull();
  });
});
