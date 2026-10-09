/*
 * A sale, order or receipt a phone took with no signal says so in its notes ("Taken offline. Check: ..."), written by the server when it arrived
 * (see OFFLINE_FIRST.md). The office screens read it from here: was it taken offline, and is there something to check.
 */
export const OFFLINE_TEXT = 'Taken offline';
export const CHECK_TEXT = 'Check:';

/** { offline, review }: review is the "Check: ..." text (what to look at), or null. */
export const offlineInfo = (notes) => {
  const text = String(notes ?? '');
  const at = text.indexOf(OFFLINE_TEXT);
  if (at < 0) return { offline: false, review: null };
  const rest = text.slice(at);
  const c = rest.indexOf(CHECK_TEXT);
  return { offline: true, review: c < 0 ? null : rest.slice(c + CHECK_TEXT.length).split(' | ')[0].trim() || null };
};

/** SQL for "taken offline and something to check" on a notes column. */
export const REVIEW_SQL = (col) => `${col} ILIKE '%Taken offline%Check:%'`;
export const OFFLINE_SQL = (col) => `${col} ILIKE '%Taken offline%'`;
