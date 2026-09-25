/*
 * All of a person's notifications, and what they want to be told about. What is
 * offered here depends on their role: someone who can't open the leakage page
 * is never offered leakage alerts. Email is off by default — it is opt-in per
 * category, and only goes out if the business has outgoing mail configured.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SEVERITY_DOT, timeAgo } from '../components/NotificationBell.jsx';
import { Alert, Button, Card, PageHeader, useToast } from '../components/ui.jsx';

const Toggle = ({ checked, onChange, label }) => (
  <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-4 w-4 accent-[var(--color-brand-500)]" />
);

const Preferences = () => {
  const toast = useToast();
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/notifications/preferences').then(setPrefs).catch((e) => setError(e.message)); }, []);

  const change = async (category, field, value) => {
    const next = prefs.map((p) => (p.category === category ? { ...p, [field]: value } : p));
    setPrefs(next);
    try { await api('/notifications/preferences', { method: 'PUT', body: { preferences: next } }); toast.success('Saved'); }
    catch (caught) { toast.error(caught.message); }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!prefs) return null;
  if (prefs.length === 0) return <p className="text-sm text-ink-500">There are no notification settings for your role.</p>;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink-900">What to tell me about</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-400"><tr><th className="py-2 font-semibold">Topic</th><th className="w-20 py-2 text-center font-semibold">In app</th><th className="w-20 py-2 text-center font-semibold">Email</th></tr></thead>
          <tbody>
            {prefs.map((p) => (
              <tr key={p.category} className="border-t border-line">
                <td className="py-3"><p className="font-medium text-ink-900">{p.label}</p><p className="text-xs text-ink-500">{p.description}</p></td>
                <td className="text-center"><Toggle checked={p.in_app} onChange={(e) => change(p.category, 'in_app', e.target.checked)} label={`${p.label} in the app`} /></td>
                <td className="text-center"><Toggle checked={p.email} onChange={(e) => change(p.category, 'email', e.target.checked)} label={`${p.label} by email`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-400">Email goes to the address you sign in with. Notifications are never sent to customers.</p>
    </Card>
  );
};

const NotificationsPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = (append = false) => {
    const before = append && items?.length ? `&before=${items[items.length - 1].notification_id}` : '';
    api(`/notifications?limit=30${unreadOnly ? '&unread=true' : ''}${before}`).then((d) => {
      setItems((cur) => (append ? [...cur, ...d.items] : d.items));
      setUnread(d.unread); setMore(d.items.length === 30);
    }).catch((e) => setError(e.message));
  };
  useEffect(() => { setItems(null); load(false); }, [unreadOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (n) => {
    if (!n.read_at) { api(`/notifications/${n.notification_id}/read`, { method: 'POST' }).catch(() => {}); setItems((cur) => cur.map((x) => (x === n ? { ...x, read_at: new Date().toISOString() } : x))); setUnread((u) => Math.max(0, u - 1)); }
    if (n.link) navigate(n.link);
  };
  const readAll = async () => { await api('/notifications/read-all', { method: 'POST' }); load(false); };

  return (
    <div>
      <PageHeader title="Notifications" lead="What needs your attention, so you don't have to go looking." action={<Button variant="secondary" onClick={readAll} disabled={!unread}>Mark all read</Button>} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Unread only
          </label>
          <Alert>{error}</Alert>
          {!items && !error && <p className="py-10 text-center text-sm text-ink-400">Loading…</p>}
          {items?.length === 0 && <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-500">{unreadOnly ? 'Nothing unread.' : 'No notifications yet. Stock, unusual-activity and trial alerts will appear here.'}</p>}
          <ul className="space-y-2">
            {items?.map((n) => (
              <li key={n.notification_id}>
                <button type="button" onClick={() => open(n)} className={`flex w-full gap-3 rounded-[--radius-card] border border-line p-4 text-left hover:bg-surface-2 ${n.read_at ? 'bg-surface' : 'bg-brand-50/50'}`}>
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`text-sm ${n.read_at ? 'text-ink-700' : 'font-semibold text-ink-900'}`}>{n.title}</span>
                      <span className="shrink-0 text-xs text-ink-400">{timeAgo(n.created_at)}</span>
                    </span>
                    {n.body && <span className="mt-1 block text-sm text-ink-500">{n.body}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {more && <Button variant="ghost" className="mt-3" onClick={() => load(true)}>Show older</Button>}
        </div>
        <Preferences />
      </div>
    </div>
  );
};

export default NotificationsPage;
