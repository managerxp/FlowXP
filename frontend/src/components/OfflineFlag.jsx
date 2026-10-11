/*
 * A sale, order or payment a phone took with no signal says so ("Taken offline", and "Check: ..." when the server wants a person to look at it:
 * short stock, a price that changed, a shop over its credit limit). The server sends `offline` and `review` with it; these show them the same
 * way on every page. See OFFLINE_FIRST.md.
 */
import { WifiOff } from 'lucide-react';

/** A small label for a list row: "Taken offline", or "Taken offline · check" when there is something to look at. */
export const OfflineChip = ({ offline, review }) => {
  if (!offline) return null;
  return (
    <span title={review || 'Made on a phone with no internet and sent later'}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-semibold ${review ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-ink-500'}`}>
      <WifiOff aria-hidden="true" className="h-3 w-3" />{review ? 'Taken offline · check' : 'Taken offline'}
    </span>
  );
};

/** The full notice on a detail page: what happened and exactly what to look at. */
export const OfflineNotice = ({ offline, review }) => {
  if (!offline) return null;
  return (
    <div role="note" className={`mb-4 rounded-(--radius-card) border p-3 text-small ${review ? 'border-warning/40 bg-warning/10 text-ink-900' : 'border-line bg-surface-2 text-ink-700'}`}>
      <p className="flex items-center gap-2 font-semibold"><WifiOff aria-hidden="true" className="h-4 w-4" />Taken offline on a phone and sent later</p>
      {review
        ? <p className="mt-1">Please check: {review}.</p>
        : <p className="mt-1 text-ink-500">Nothing needs a look: the server accepted it as it was made.</p>}
    </div>
  );
};
