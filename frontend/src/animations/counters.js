/*
 * A number that counts up to its real value instead of appearing already-set
 * — used on the dashboard mockup's stat tiles. Ticks on an internal proxy
 * object rather than parsing the DOM node's own text, so the caller can
 * format however it likes (currency, a plain integer, a percentage).
 */
import { gsap, prefersReducedMotion } from './gsap.js';

/**
 * @param {HTMLElement} target - the node whose textContent gets written to
 * @param {number} to - the final value
 * @param {object} options
 * @param {number} [options.from=0]
 * @param {number} [options.duration=1.4]
 * @param {(n: number) => string} [options.format] - defaults to a rounded integer
 */
export const counterAnimation = (target, to, { from = 0, duration = 1.4, delay = 0, format } = {}) => {
  const render = format || ((n) => Math.round(n).toLocaleString('en-IN'));

  if (prefersReducedMotion()) {
    target.textContent = render(to);
    return null;
  }

  const proxy = { value: from };
  target.textContent = render(from);

  return gsap.to(proxy, {
    value: to,
    duration,
    delay,
    ease: 'power2.out',
    onUpdate: () => { target.textContent = render(proxy.value); }
  });
};
