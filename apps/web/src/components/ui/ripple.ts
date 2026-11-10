import type { PointerEvent } from 'react';

/**
 * Material's pressed state: a ripple of the content colour that spreads from the point of contact
 * (m3.material.io/foundations/interaction/states/state-layers). No maintained React ripple exists
 * for Material 3, so this is the small one the app needs, on the Web Animations API (no
 * dependency). The hover and focus washes are CSS (`state-layer` in index.css); this adds only
 * the press. Not drawn when the person asked for reduced motion, nor where `animate` is missing
 * (jsdom); the CSS press wash covers both.
 *
 * Use it as a pointer-down handler on a positioned control (`relative` or `absolute`):
 * `onPointerDown={withRipple(props.onPointerDown)}`. `data-ripple="off"` on a control turns it
 * off (a button drawn as a text field, which Material gives no ripple).
 */
export function ripple(event: PointerEvent<HTMLElement>): void {
  const host = event.currentTarget;
  if (event.button !== 0 || typeof host.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (host.matches(':disabled, [aria-disabled="true"], [data-disabled], [data-ripple="off"]'))
    return;

  const box = host.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  // Big enough to reach the farthest corner from the point pressed.
  const radius = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));

  const clip = document.createElement('span');
  clip.setAttribute('aria-hidden', 'true');
  clip.dataset.slot = 'ripple';
  Object.assign(clip.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    borderRadius: 'inherit',
    pointerEvents: 'none',
  });
  const wave = document.createElement('span');
  Object.assign(wave.style, {
    position: 'absolute',
    left: `${x - radius}px`,
    top: `${y - radius}px`,
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
    borderRadius: '50%',
    backgroundColor: 'currentColor',
  });
  wave.style.setProperty('opacity', 'var(--md-sys-state-pressed-state-layer-opacity)');
  clip.append(wave);
  host.append(clip);

  // md.sys.motion: the spread is long1 (450 ms) on the standard curve; the fade is short3 (150 ms).
  const grow = wave.animate([{ transform: 'scale(0.2)' }, { transform: 'scale(1)' }], {
    duration: 450,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    fill: 'forwards',
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
      host.removeEventListener(type, release);
    // Let a quick tap show at least part of the spread before it fades.
    const wait = Math.max(0, 225 - Number(grow.currentTime ?? 0));
    window.setTimeout(() => {
      const fade = wave.animate([{ opacity: 0 }], {
        duration: 150,
        easing: 'linear',
        fill: 'forwards',
      });
      fade.onfinish = () => clip.remove();
    }, wait);
  };
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
    host.addEventListener(type, release);
}

/** `ripple` in front of a component's own pointer-down handler. */
export function withRipple<E extends HTMLElement>(
  own?: (event: PointerEvent<E>) => void,
): (event: PointerEvent<E>) => void {
  return (event) => {
    own?.(event);
    if (!event.defaultPrevented) ripple(event);
  };
}
