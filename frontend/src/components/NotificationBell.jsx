/*
 * The bell in the top bar: an unread count, and the latest few notifications.
 * The count is polled once a minute (and when the tab regains focus) — cheap
 * enough not to need a socket, and it stays quiet while the tab is hidden.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

export const SEVERITY_DOT = { critical: 'bg-danger', warning: 'bg-warning', positive: 'bg-success', informational: 'bg-ink-300' };

export const timeAgo = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const NotificationBell = () => {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const box = useRef(null);

  const refreshCount = useCallback(() => {
    if (document.hidden) return;
    api('/notifications/count').then((d) => setUnread(d.unread)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, 60000);
    window.addEventListener('focus', refreshCount);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshCount); };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    api('/notifications?limit=8').then((d) => { setItems(d.items); setUnread(d.unread); }).catch(() => setItems([]));
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const go = async (n) => {
    setOpen(false);
    if (!n.read_at) { setUnread((u) => Math.max(0, u - 1)); api(`/notifications/${n.notification_id}/read`, { method: 'POST' }).catch(() => {}); }
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-600 hover:bg-surface-2"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" /><path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            <Link to="/app/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-brand-600">See all</Link>
          </div>
          {!items && <p className="px-4 py-6 text-center text-sm text-ink-400">Loading…</p>}
          {items?.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-400">Nothing new. You're all caught up.</p>}
          <ul className="max-h-96 overflow-y-auto">
            {items?.map((n) => (
              <li key={n.notification_id}>
                <button type="button" onClick={() => go(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2 ${n.read_at ? '' : 'bg-brand-50/50'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className={`block text-sm ${n.read_at ? 'text-ink-700' : 'font-semibold text-ink-900'}`}>{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-500">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-ink-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
