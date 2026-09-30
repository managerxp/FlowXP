/*
 * One place that touches the gsap import and plugin registration.
 *
 * Registering ScrollTrigger in every file that uses it is harmless but
 * repetitive; registering it twice is not a bug, but scattering the
 * registration means nobody can see, in one place, which plugins this app
 * actually depends on.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/*
 * The one rule every animation in this app obeys: someone who has asked their
 * OS to reduce motion gets the end state immediately, not a slower version of
 * the same motion. Checked once per call site via gsap.matchMedia() rather
 * than sprinkling `window.matchMedia` checks through every component.
 */
export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export { gsap, ScrollTrigger };
