/*
 * What the person at the till needs to know when the connection drops: that it has, that sales are being
 * kept safe on this device, how many are waiting, and what became of any the server refused.
 * Also the "install the app" button.
 */
import { useEffect, useState } from 'react';
import { queue, startAutoSync, useOnline, useQueuedSales } from '../lib/offline.js';
import { useInstall } from '../lib/pwa.js';
import { Button, Modal, useToast } from './ui.jsx';

const when = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const Review = ({ items, onClose }) => {
  const [busy, setBusy] = useState(false);
  const discard = (item) => { if (window.confirm(`Discard this sale (${item.label})? It will never be billed.`)) queue.remove(item.id); };
  return (
    <Modal title="Sales waiting to sync" onClose={onClose}>
      <div className="space-y-3">
        {items.length === 0 && <p className="text-sm text-ink-500">Nothing is waiting.</p>}
        {items.map((item) => (
          <div key={item.id} className={`rounded-lg border p-3 text-sm ${item.state === 'failed' ? 'border-danger/40 bg-danger/5' : 'border-line'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink-900">{item.label}</p>
                <p className="text-xs text-ink-500">Taken at {when(item.createdAt)}</p>
              </div>
              <span className={`text-xs font-semibold ${item.state === 'failed' ? 'text-danger' : 'text-amber-600'}`}>{item.state === 'failed' ? 'Refused' : 'Waiting'}</span>
            </div>
            {item.error && <p className="mt-2 text-xs text-danger">{item.error}</p>}
            <div className="mt-2 flex gap-3">
              {item.state === 'failed' && <button className="text-xs font-semibold text-brand-600" onClick={() => { queue.retry(item.id); queue.flush(); }}>Try again</button>}
              <button className="text-xs font-semibold text-danger" onClick={() => discard(item)}>Discard</button>
            </div>
          </div>
        ))}
        {items.some((i) => i.state === 'failed') && <p className="text-xs text-ink-500">A refused sale usually means something changed (an item ran out, a coupon expired). Fix it, then try again, or ring it up fresh and discard this one.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy || !items.some((i) => i.state === 'pending')} onClick={async () => { setBusy(true); await queue.flush(); setBusy(false); }}>{busy ? 'Syncing…' : 'Sync now'}</Button>
        </div>
      </div>
    </Modal>
  );
};

export const OfflineStatus = () => {
  const toast = useToast();
  const online = useOnline();
  const items = useQueuedSales();
  const [reviewing, setReviewing] = useState(false);
  const waiting = items.filter((i) => i.state === 'pending').length;
  const refused = items.filter((i) => i.state === 'failed').length;

  useEffect(() => startAutoSync(({ sent, failed }) => {
    if (sent) toast.success(`${sent} offline sale${sent === 1 ? '' : 's'} billed`);
    if (failed) toast.error(`${failed} offline sale${failed === 1 ? ' was' : 's were'} refused. Review them.`);
  }), [toast]);

  if (online && !waiting && !refused) return null;
  const tone = !online ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200' : refused ? 'bg-danger/10 text-danger' : 'bg-brand-50 text-brand-700';
  return (
    <>
      <div role="status" className={`flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm print:hidden ${tone}`}>
        <span>
          {!online && <strong>You're offline. </strong>}
          {!online && waiting === 0 && 'You can still ring up sales; they are kept on this device and billed when the connection is back.'}
          {waiting > 0 && `${waiting} sale${waiting === 1 ? '' : 's'} waiting to sync.`}
          {refused > 0 && ` ${refused} refused.`}
        </span>
        {items.length > 0 && <button className="font-semibold underline" onClick={() => setReviewing(true)}>Review</button>}
      </div>
      {reviewing && <Review items={items} onClose={() => setReviewing(false)} />}
    </>
  );
};

/** "Install app" (Android, desktop Chrome) or how to on an iPhone. Hidden once it is installed. */
export const InstallButton = () => {
  const { canInstall, install, showIosHint } = useInstall();
  const [hint, setHint] = useState(false);
  if (!canInstall && !showIosHint) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={canInstall ? install : () => setHint(true)}>Install app</Button>
      {hint && (
        <Modal title="Install FlowXP on your iPhone" onClose={() => setHint(false)}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700">
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
            <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          </ol>
          <p className="mt-3 text-xs text-ink-500">FlowXP then opens full screen like any app.</p>
        </Modal>
      )}
    </>
  );
};
