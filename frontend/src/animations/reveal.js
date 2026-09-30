/*
 * The reveal vocabulary: fadeUp, fadeIn, scaleIn, staggerReveal, textReveal,
 * cardReveal. Every marketing section on the site composes these instead of
 * writing its own gsap.from() — so a hero and a pricing card animate with the
 * same easing and the same restraint, and "make it feel premium" is a
 * property of these five functions rather than a taste applied inconsistently
 * per component.
 *
 * Every function takes plain DOM nodes (or an array of them) and returns the
 * gsap Tween/Timeline it created, so callers can add it to their own
 * useGSAP() scope for cleanup. None of them touch ScrollTrigger themselves —
 * that composition happens in scroll.js, so a caller can reveal-on-mount or
 * reveal-on-scroll with the same base animation.
 */
import { gsap, prefersReducedMotion } from './gsap.js';

/* The one easing curve used for every entrance in the product. Confident and
   quick, no bounce — a bounce reads as playful, and FlowXP is not a toy. */
const EASE = 'power3.out';

export const fadeUp = (targets, { duration = 0.7, distance = 28, delay = 0, ...rest } = {}) => {
  if (prefersReducedMotion()) {
    return gsap.set(targets, { opacity: 1, y: 0, ...rest });
  }
  return gsap.from(targets, { opacity: 0, y: distance, duration, delay, ease: EASE, ...rest });
};

export const fadeIn = (targets, { duration = 0.6, delay = 0, ...rest } = {}) => {
  if (prefersReducedMotion()) {
    return gsap.set(targets, { opacity: 1, ...rest });
  }
  return gsap.from(targets, { opacity: 0, duration, delay, ease: EASE, ...rest });
};

export const scaleIn = (targets, { duration = 0.7, from = 0.94, delay = 0, ...rest } = {}) => {
  if (prefersReducedMotion()) {
    return gsap.set(targets, { opacity: 1, scale: 1, ...rest });
  }
  return gsap.from(targets, { opacity: 0, scale: from, duration, delay, ease: EASE, ...rest });
};

/*
 * One element after another, not all at once — this is what makes a row of
 * feature cards or pricing plans read as composed rather than dumped on
 * screen. `each` is the gap between starts, not the duration of each item.
 */
export const staggerReveal = (targets, { each = 0.09, distance = 24, duration = 0.6, ...rest } = {}) => {
  if (prefersReducedMotion()) {
    return gsap.set(targets, { opacity: 1, y: 0, ...rest });
  }
  return gsap.from(targets, {
    opacity: 0, y: distance, duration, ease: EASE,
    stagger: each, ...rest
  });
};

/*
 * A headline revealing line by line. Takes the lines as an array of elements
 * already split in JSX (one <span> per line) rather than parsing text at
 * runtime — a runtime text-splitter has to fight the browser's own line
 * wrapping on every resize, and a hero headline's line breaks are already
 * authored deliberately in the markup.
 */
export const textReveal = (lines, { each = 0.12, duration = 0.8, delay = 0 } = {}) => {
  if (prefersReducedMotion()) {
    return gsap.set(lines, { opacity: 1, y: 0 });
  }
  return gsap.from(lines, {
    opacity: 0, y: '100%', duration, delay, ease: EASE, stagger: each
  });
};

/* A card's entrance: a fade-up with a hint of scale, tuned slightly slower
   than a plain fadeUp so a grid of cards feels considered rather than snappy. */
export const cardReveal = (targets, { each = 0.1, delay = 0 } = {}) => {
  if (prefersReducedMotion()) {
    return gsap.set(targets, { opacity: 1, y: 0, scale: 1 });
  }
  return gsap.from(targets, {
    opacity: 0, y: 32, scale: 0.97, duration: 0.7, delay, ease: EASE, stagger: each
  });
};
