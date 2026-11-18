/** The delay before the nth item of a list appears: a quick, short stagger that never makes a long list wait. Pure, so it can be tested. */
export const staggerDelay = (index: number, step = 40, max = 240): number => Math.min(Math.max(0, index) * step, max);
