/*
 * The FlowBook link: send this business's sales, returns and payments to FlowBook (accounting) so the books keep themselves.
 * The secret is made in FlowBook (Integrations, FlowXP) and pasted here once; it is stored encrypted and never shown again.
 * What cannot be sent is listed with the reason, because a sale that is not sent is a sale missing from the books.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Card, Badge, Button, Field, Input, Alert, StatCard, Table, Thead, Th, Td, Tr } from '../components/ui.jsx';

const KIND = { 'sale.finalized': 'Sale', 'sale.voided': 'Cancelled sale', 'sale.returned': 'Credit note', 'payment.received': 'Payment' };
const when = (value) => (value ? new Date(value).toLocaleString() : 'never');

const FlowBookPage = () => {
  const { businessId } = useAuth();
  const [data, setData] = useState(null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /* One sign-in: FlowXP hands you to FlowBook already signed in, with this business's trial. `?open=1` (from the website's FlowBook page) does it on arrival. */
  const openBook = () => run('open', async () => { const r = await api('/flowbook/launch', { method: 'POST' }); window.location.assign(r.url); });
  useEffect(() => { if (new URLSearchParams(window.location.search).get('open') === '1') openBook(); }, []);

  const load = () => api('/flowbook').then((d) => {
    setData(d);
    if (d.link) { setUrl(d.link.base_url); setEnabled(d.link.enabled); }
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const run = async (name, fn) => {
    setBusy(name); setError(''); setNotice('');
    try { await fn(); } catch (caught) { setError(caught.message); } finally { setBusy(''); }
  };

  const save = (event) => {
    event.preventDefault();
    return run('save', async () => {
      const result = await api('/flowbook', { method: 'PUT', body: { base_url: url, secret: secret || undefined, enabled } });
      setData(result); setSecret('');
      setNotice(enabled ? 'Saved. Sales made from now on are sent to FlowBook.' : 'Saved. Nothing is being sent.');
    });
  };
  const test = () => run('test', async () => { await api('/flowbook/test', { method: 'POST' }); setNotice('FlowBook answered and accepted the signature.'); });
  const retry = () => run('retry', async () => {
    const r = await api('/flowbook/retry', { method: 'POST' });
    setNotice(`${r.retried} parked ${r.retried === 1 ? 'item was' : 'items were'} put back in the queue.`);
    await load();
  });

  if (!data) return <div><PageHeader title="FlowBook" lead="Send every sale to your books." /><Alert>{error}</Alert>{busy === 'open' && <p className="text-sm text-ink-500" role="status">Opening FlowBook...</p>}</div>;
  const { link, counts, problems } = data;

  return (
    <div className="space-y-6">
      <PageHeader title="FlowBook" lead="Every sale, return and payment goes to FlowBook as it happens, so your books and GST figures keep themselves. Only what you bill after you switch this on is sent." />
      <Alert>{error}</Alert>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-500">Your FlowXP sign-in and free trial work in FlowBook too. No second login.</p>
          <Button onClick={openBook} loading={busy === 'open'}>Open FlowBook</Button>
        </div>
      </Card>
      {notice && <p className="text-sm text-success" role="status">{notice}</p>}

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink-900">Connection</h3>
          <Badge tone={link?.enabled ? 'success' : 'neutral'}>{link?.enabled ? 'Sending' : link ? 'Switched off' : 'Not connected'}</Badge>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-500">
          <li>In FlowBook, open Integrations, then FlowXP, and connect this business. Its number in FlowXP is <strong className="text-ink-900">{businessId}</strong>.</li>
          <li>Copy the secret FlowBook shows you (it shows it once) and paste it below, with your FlowBook address.</li>
          <li>Press Save, then Test connection.</li>
        </ol>
        <form onSubmit={save} className="mt-4 space-y-3">
          <Field id="fb-url" label="FlowBook address" hint="Starts with https://">
            <Input id="fb-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://books.example.com" required />
          </Field>
          <Field id="fb-secret" label="Secret" hint={link ? 'Leave empty to keep the saved secret.' : 'Starts with fxs_'}>
            <Input id="fb-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={link ? '••••••••' : 'fxs_…'} required={!link} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Send my sales to FlowBook
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'save'}>Save</Button>
            {link && <Button type="button" variant="secondary" loading={busy === 'test'} onClick={test}>Test connection</Button>}
          </div>
        </form>
        {link?.last_ok_at && <p className="mt-3 text-xs text-ink-400">Last sent {when(link.last_ok_at)}</p>}
        {link?.last_error && <p className="mt-1 text-xs text-danger">Last problem: {link.last_error}</p>}
      </Card>

      {link && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Sent" value={counts.sent} />
            <StatCard label="Waiting" value={counts.pending} />
            <StatCard label="Not sent" value={counts.skipped} tone={counts.skipped ? 'text-warning' : undefined} />
            <StatCard label="Parked" value={counts.dead} tone={counts.dead ? 'text-danger' : undefined} />
          </div>

          {(problems.length > 0) && (
            <Card>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-ink-900">Needs a look</h3>
                {counts.dead > 0 && <Button size="sm" variant="secondary" loading={busy === 'retry'} onClick={retry}>Try the parked ones again</Button>}
              </div>
              <p className="mt-1 text-sm text-ink-500">
                <strong>Not sent</strong> means FlowBook cannot record that document correctly yet, so it is missing from your books until you enter it there.{' '}
                <strong>Parked</strong> means sending failed many times; fix the cause above, then try again.
              </p>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <Thead><tr><Th>What</Th><Th>Document</Th><Th>Status</Th><Th>Why</Th></tr></Thead>
                  <tbody>
                    {problems.map((p) => (
                      <Tr key={p.outbox_id}>
                        <Td>{KIND[p.event_type] || p.event_type}</Td>
                        <Td>#{p.source_id}</Td>
                        <Td><Badge tone={p.status === 'DEAD' ? 'danger' : 'warning'}>{p.status === 'DEAD' ? 'Parked' : 'Not sent'}</Badge></Td>
                        <Td>{p.last_error}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default FlowBookPage;
