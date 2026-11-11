/* Shown at the top of every screen while a kitchen ticket has not reached a printer. A toast fades away, but a kitchen that cooks from printed slips
   would never know the order exists, so this stays until the tickets print (Print again) or someone says they have handled it (Dismiss). */
import { useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import { dismissFailedKots, getFailedKots, reprintFailedKots, subscribeFailedKots } from '../lib/printing.js';
import { useT } from '../i18n/useT.js';

const KitchenPrintWarning = () => {
  const tr = useT();
  const failed = useSyncExternalStore(subscribeFailedKots, getFailedKots);
  if (!failed.length) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-red-600 px-4 py-2 text-small font-medium text-white shadow-lg">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{tr('Kitchen tickets that did not print: {{n}}. The kitchen may not know about them.', { n: failed.length })}</span>
      <button type="button" onClick={() => reprintFailedKots()} className="rounded-md bg-white px-3 py-1 font-semibold text-red-700 hover:bg-red-50">{tr('Print again')}</button>
      <button type="button" onClick={dismissFailedKots} className="rounded-md border border-white/70 px-3 py-1 hover:bg-red-700">{tr('Dismiss')}</button>
    </div>
  );
};

export default KitchenPrintWarning;
