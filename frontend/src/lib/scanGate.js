/*
 * Decides whether a barcode detection is a NEW scan. A camera reports the same barcode in dozens of frames while it
 * is held in front of the lens; a shopper wants one beep per item, and a second beep when they present the same item
 * again. So a code counts once, and counts again only after it has left the view for `presentGapMs`.
 *
 * Every code in view is tracked on its own (seen, and whether it has already counted), so two barcodes in the frame
 * at once each count once and do not keep re-triggering each other. `minGapMs` stops one burst of frames from
 * registering two different codes in the same instant; a code held back by it still counts once the burst has passed.
 *
 * Pure, with an injectable clock, so the timing rules can be tested without a camera.
 */
export const createScanGate = ({ minGapMs = 250, presentGapMs = 700, now = () => Date.now() } = {}) => {
  const inView = new Map();   // code -> { lastSeen, counted }
  let lastAccepted = -Infinity;
  const gate = (code) => {
    const t = now();
    let entry = inView.get(code);
    if (!entry || t - entry.lastSeen >= presentGapMs) entry = { lastSeen: t, counted: false };   // new, or back after leaving
    entry.lastSeen = t;
    inView.set(code, entry);
    if (inView.size > 32) for (const [k, e] of inView) if (t - e.lastSeen > presentGapMs) inView.delete(k);
    if (entry.counted) return false;                    // still in front of the lens
    if (t - lastAccepted < minGapMs) return false;      // another code in the same burst
    entry.counted = true; lastAccepted = t;
    return true;
  };
  // an item that was just added another way (made at the till while it was in the shopper's hand): do not count it
  // again if it is still in front of the lens when the camera comes back
  gate.mark = (code, holdMs = 2500) => { inView.set(code, { lastSeen: now() + holdMs, counted: true }); lastAccepted = now(); };
  return gate;
};
