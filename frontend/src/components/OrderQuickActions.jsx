/*
 * Print the running bill and look at an order, from the floor, in one tap each. Both are big (44px) buttons so a finger on a
 * tablet or a touch till can hit them without care, and neither depends on hover.
 */
import { useState } from 'react';
import { Eye, Printer } from 'lucide-react';
import { printBill } from '../lib/printing.js';
import { useToast } from './ui.jsx';
import { useT } from '../i18n/useT.js';

const BTN = 'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-small font-semibold text-ink-800 transition-colors duration-(--duration-fast) hover:border-ink-400 active:bg-surface-3 disabled:opacity-50';

const OrderQuickActions = ({ orderId, canPrint = true, onView, onPrinted }) => {
  const tr = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    try { const silent = await printBill(orderId); if (silent) toast.success(tr('Bill sent to the printer')); onPrinted?.(); }
    catch (caught) { toast.error(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex gap-2 border-t border-line/70 p-2">
      <button type="button" onClick={print} disabled={busy || !canPrint} aria-label={tr('Print the bill')} className={BTN}><Printer aria-hidden="true" className="h-4 w-4" />{tr('Print')}</button>
      <button type="button" onClick={onView} aria-label={tr('View the order')} className={BTN}><Eye aria-hidden="true" className="h-4 w-4" />{tr('View')}</button>
    </div>
  );
};

export default OrderQuickActions;
