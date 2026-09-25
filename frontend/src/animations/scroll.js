/*
 * ScrollTrigger composition on top of reveal.js.
 *
 * These functions don't invent new motion — they take a reveal.js animation
 * and gate it behind a scroll position instead of firing on mount. Splitting
 * it this way means "what does it look like" (reveal.js) and "when does it
 * play" (this file) can be reasoned about separately.
 */
import { gsap, ScrollTrigger, prefersReducedMotion } from './gsap.js';

/*
 * Run a reveal.js animation once, the first time `trigger` crosses into view.
 * `start` follows ScrollTrigger's own syntax ("top 80%" etc.) — exposed
 * rather than hidden, because tuning exactly when a section starts revealing
 * is the one ScrollTrigger knob every caller ends up needing.
 */
export const revealOnScroll = (trigger, animate, { start = 'top 82%' } = {}) => {
  if (prefersReducedMotion()) {
    animate();
    return null;
  }
  return ScrollTrigger.create({
    trigger,
    start,
    once: true,
    onEnter: animate
  });
};

/*
 * The "One Flow" mechanism: pin a section for the height of `steps.length`
 * screens and drive a 0→1 progress value as the user scrolls through it,
 * instead of firing N separate reveals. `onUpdate` receives that progress
 * plus the currently active step index, so the caller decides what "active"
 * looks like (a filled connector line, a highlighted card) without this file
 * knowing anything about the visual design.
 *
 * Falls back to no pin and progress=1 under reduced motion — the content
 * still renders, just without scroll-scrubbed motion.
 */
export const scrollFlow = (container, steps, { onUpdate, pinSpacing = true } = {}) => {
  if (prefersReducedMotion()) {
    onUpdate?.({ progress: 1, activeIndex: steps.length - 1 });
    return null;
  }

  return ScrollTrigger.create({
    trigger: container,
    start: 'top top',
    end: () => `+=${container.offsetHeight * (steps.length - 1)}`,
    pin: true,
    pinSpacing,
    scrub: 0.6,
    onUpdate: (self) => {
      const progress = self.progress;
      const activeIndex = Math.min(
        steps.length - 1,
        Math.floor(progress * steps.length)
      );
      onUpdate?.({ progress, activeIndex });
    }
  });
};

/*
 * A row that scrolls sideways as the page scrolls down — logos, a filmstrip
 * of screenshots. Used sparingly by design (the brief is explicit that not
 * everything should move); provided because the brief asks for it as
 * reusable infrastructure even where this build doesn't reach for it yet.
 */
export const horizontalScroll = (container, track, { start = 'top top' } = {}) => {
  if (prefersReducedMotion()) return null;

  const distance = track.scrollWidth - container.offsetWidth;
  if (distance <= 0) return null;

  return gsap.to(track, {
    x: -distance,
    ease: 'none',
    scrollTrigger: {
      trigger: container,
      start,
      end: () => `+=${distance}`,
      scrub: 0.6,
      pin: true
    }
  });
};
