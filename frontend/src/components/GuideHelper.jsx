/*
 * "Help me find it": a button on every screen of the app. Say what you want to do in your own words ("add racks", "points",
 * "bill a garage") and it shows the screens that do it, one tap to open. It only lists screens this person can open
 * (it works from the same list as the side menu), costs nothing, and works offline. Questions about the business itself
 * go to Flow AI, which is linked at the bottom.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, LifeBuoy, Search, Sparkles, X } from 'lucide-react';
import { T, useT } from '../i18n/useT.js';

/* text: what the person wants to do; to: the first of these that this person can open wins; words: other ways to say it. */
const TASKS = [
  { text: T('Make a bill'), to: ['/app/billing', '/app/pharmacy/pos', '/app/salon/pos', '/app/gaming', '/app/gym/reception'], words: 'bill invoice sell sale checkout counter till' },
  { text: T('Add a customer'), to: ['/app/customers', '/app/wholesale/customers', '/app/salon/clients'], words: 'customer client party garage add new' },
  { text: T('Import customers from Tally, Vyapar or Excel'), to: ['/app/customers', '/app/wholesale/customers'], words: 'import customers tally vyapar busy excel csv upload file' },
  { text: T('Add or import products'), to: ['/app/stock', '/app/products', '/app/wholesale/products', '/app/pharmacy/products'], words: 'product item part import excel csv tally vyapar upload add new price' },
  { text: T('Set up my racks and bins'), to: ['/app/parts/warehouse'], words: 'rack racks bin bins shelf shelves godown warehouse location setup layout' },
  { text: T('Put received parts on a shelf'), to: ['/app/parts/warehouse?tab=putaway'], words: 'put away shelf bin rack received waiting' },
  { text: T('Find where a part is kept'), to: ['/app/parts/catalogue'], words: 'where part find location rack bin shelf search' },
  { text: T('Move stock from one bin to another'), to: ['/app/parts/warehouse?tab=move'], words: 'move transfer bin rack shelf shift' },
  { text: T('Print rack and bin labels'), to: ['/app/parts/warehouse'], words: 'label labels print qr barcode rack bin' },
  { text: T('Receive parts from a supplier'), to: ['/app/parts/receive', '/app/purchases', '/app/wholesale/purchasing', '/app/pharmacy/grn'], words: 'receive delivery supplier purchase goods stock in grn' },
  { text: T('Open a job card for a vehicle'), to: ['/app/parts/jobs'], words: 'job card servicing service vehicle bike car workshop mechanic' },
  { text: T('Find parts that fit a vehicle'), to: ['/app/parts/vehicles'], words: 'vehicle fit fitment make model bike car' },
  { text: T('Add staff, attendance and payroll'), to: ['/app/parts/staff', '/app/hotel/staff', '/app/staff', '/app/salon/team'], words: 'staff employee mechanic attendance salary payroll shift login role' },
  { text: T('Loyalty points: how many a customer earns'), to: ['/app/loyalty'], words: 'loyalty points earn reward tier redeem' },
  { text: T('Make a coupon or offer code'), to: ['/app/loyalty', '/app/offers'], words: 'coupon offer code discount promo voucher' },
  { text: T('See sales and reports'), to: ['/app/reports', '/app/parts/reports', '/app/wholesale/reports', '/app/salon/reports'], words: 'report reports sales today profit summary' },
  { text: T('Check what is low in stock'), to: ['/app/stock', '/app/parts/reports', '/app/inventory', '/app/wholesale/inventory'], words: 'low stock reorder buy what to buy finished out' },
  { text: T('Who owes me money'), to: ['/app/customers', '/app/wholesale/money', '/app/parts/trade'], words: 'owe due credit udhaar pending balance receivable collect' },
  { text: T('Record an expense'), to: ['/app/expenses'], words: 'expense spend rent salary cost' },
  { text: T('File GST'), to: ['/app/gst'], words: 'gst gstr return filing tax hsn' },
  { text: T('Download or restore a backup'), to: ['/app/settings'], words: 'backup restore download data export safe' },
  { text: T('Change my shop details, printer or prefix'), to: ['/app/settings'], words: 'settings shop business gstin address printer receipt prefix logo' },
  { text: T('Ask Flow AI a question about my business'), to: ['/app/ai'], words: 'ai ask question flow insight manager why how' }
];

const base = (to) => to.split('?')[0];

const GuideHelper = ({ items }) => {
  const tr = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef(null);
  const can = useMemo(() => new Set(items.map((i) => i.to)), [items]);

  // the first screen of each task this person can open
  const available = useMemo(() => TASKS.map((t) => ({ ...t, go: t.to.find((p) => can.has(base(p))) })).filter((t) => t.go), [can]);
  const shown = useMemo(() => {
    const tokens = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!tokens.length) return available.slice(0, 8);
    return available
      .map((t) => {
        const hay = `${t.text} ${t.words} ${tr(t.text)}`.toLowerCase().split(/[^\p{L}\p{N}]+/u);
        const hit = tokens.filter((k) => hay.some((w) => w.startsWith(k))).length;
        return [hit, t];
      })
      .filter(([hit]) => hit > 0).sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, t]) => t);
  }, [available, q, tr]);
  // screens by their own name too, so "Suppliers" or "Expenses" always works
  const byName = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k.length < 2 ? [] : items.filter((i) => i.label.toLowerCase().includes(k) && !shown.some((t) => base(t.go) === i.to)).slice(0, 3);
  }, [items, q, shown]);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); else setQ(''); }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  // the till is a full screen of its own: keep the button off it
  if (/^\/app\/(billing$|pharmacy\/pos|salon\/pos)/.test(pathname)) return null;
  const go = (to) => { setOpen(false); navigate(to); };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={tr('Help me find a screen')}
                className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-brand-500 px-4 py-3 text-small font-semibold text-white shadow-lg hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 lg:bottom-6">
          <LifeBuoy aria-hidden="true" className="h-4 w-4" /> {tr('Help me find')}
        </button>
      )}
      {open && (
        <div role="dialog" aria-label={tr('Help me find a screen')} className="fixed bottom-20 right-4 z-50 flex max-h-[80vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface shadow-lg lg:bottom-6">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-body font-semibold text-ink-900">{tr('What do you want to do?')}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label={tr('Close')} className="rounded p-1 text-ink-500 hover:bg-surface-2"><X aria-hidden="true" className="h-4 w-4" /></button>
          </div>
          <div className="relative border-b border-line p-3">
            <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('For example: add racks, points, job card')}
                   onKeyDown={(e) => { if (e.key === 'Enter' && (shown[0] || byName[0])) go(shown[0]?.go || byName[0].to); }}
                   className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-small text-ink-900 focus:border-brand-500 focus:outline-none" />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {shown.map((t) => (
              <li key={t.text}><button type="button" onClick={() => go(t.go)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-small text-ink-900 hover:bg-surface-2">
                <span>{tr(t.text)}</span><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-400" /></button></li>
            ))}
            {byName.map((i) => (
              <li key={i.to}><button type="button" onClick={() => go(i.to)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-small text-ink-900 hover:bg-surface-2">
                <span>{i.label} <span className="text-caption text-ink-500">· {i.group}</span></span><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-400" /></button></li>
            ))}
            {q.trim() && shown.length === 0 && byName.length === 0 && <li className="px-3 py-3 text-small text-ink-500">{tr('No screen found for that. Try another word, or ask Flow AI below.')}</li>}
          </ul>
          {can.has('/app/ai') && (
            <button type="button" onClick={() => go('/app/ai')} className="flex items-center gap-2 border-t border-line bg-brand-50 px-4 py-3 text-left text-small font-semibold text-brand-700 hover:bg-brand-100">
              <Sparkles aria-hidden="true" className="h-4 w-4" /> {tr('Ask Flow AI about your business')}
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default GuideHelper;
