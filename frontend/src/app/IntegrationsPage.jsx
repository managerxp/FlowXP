/*
 * Delivery platform connections — Zomato, Swiggy, ONDC, Magicpin. Every
 * platform-specific detail (parsing a webhook, pushing a menu) lives behind
 * the adapter registry on the backend; this screen only does the part every
 * platform shares: turn the connection on, save whatever credentials the
 * adapter needs, and prove the whole pipeline works with a test order before
 * a real one ever arrives.
 *
 * A "connected" order — real or simulated — becomes a normal `order` with a
 * KOT already sent (see integrations.controller.js's ingestOrder), so it
 * just shows up on Orders and Kitchen Display like anything else. No
 * separate "incoming orders" view is needed here.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { PageHeader, Card, Badge, Button, Field, Input, Alert } from '../components/ui.jsx';

const PLATFORM_LABEL = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin' };

const PlatformCard = ({ integration, onChanged }) => {
  const [apiKey, setApiKey] = useState('');
  const [outletId, setOutletId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const save = async (patch) => {
    setBusy('save'); setError(''); setNotice('');
    try {
      await api(`/integrations/${integration.platform}`, { method: 'PATCH', body: patch });
      onChanged();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(''); }
  };

  const connect = () => save({ is_enabled: true, credentials: { api_key: apiKey || undefined, outlet_id: outletId || undefined } });
  const disconnect = () => save({ is_enabled: false });

  const syncMenu = async () => {
    setBusy('sync'); setError(''); setNotice('');
    try {
      await api(`/integrations/${integration.platform}/sync-menu`, { method: 'POST' });
      setNotice('Menu synced.');
      onChanged();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(''); }
  };

  const sendTestOrder = async () => {
    setBusy('test'); setError(''); setNotice('');
    try {
      const result = await api(`/integrations/${integration.platform}/simulate-order`, { method: 'POST' });
      setNotice(`Test order ${result.order_number} sent to the kitchen — check Orders or Kitchen Display.`);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(''); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-ink-900">{PLATFORM_LABEL[integration.platform]}</h3>
        <Badge tone={integration.is_enabled ? 'success' : 'neutral'}>{integration.is_enabled ? 'Connected' : 'Not connected'}</Badge>
      </div>
      {integration.last_synced_at && (
        <p className="mt-1 text-xs text-ink-400">Menu last synced {new Date(integration.last_synced_at).toLocaleString()}</p>
      )}

      <Alert>{error}</Alert>
      {notice && <p className="mt-2 text-sm text-success">{notice}</p>}

      {!integration.is_enabled ? (
        <div className="mt-4 space-y-3">
          <Field id={`${integration.platform}-key`} label="API key">
            <Input id={`${integration.platform}-key`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Partner API key" />
          </Field>
          <Field id={`${integration.platform}-outlet`} label="Outlet / store ID">
            <Input id={`${integration.platform}-outlet`} value={outletId} onChange={(e) => setOutletId(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={busy === 'save'} onClick={connect}>{busy === 'save' ? 'Connecting…' : 'Connect'}</Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy === 'sync'} onClick={syncMenu}>{busy === 'sync' ? 'Syncing…' : 'Sync menu'}</Button>
          <Button size="sm" variant="secondary" disabled={busy === 'test'} onClick={sendTestOrder}>{busy === 'test' ? 'Sending…' : 'Send test order'}</Button>
          <Button size="sm" variant="ghost" disabled={busy === 'save'} onClick={disconnect}>Disconnect</Button>
        </div>
      )}
    </Card>
  );
};

const IntegrationsPage = () => {
  const [integrations, setIntegrations] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/integrations').then(setIntegrations).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Delivery integrations" lead="Zomato, Swiggy and other delivery platforms — orders land straight in your kitchen queue." />
      <Alert>{error}</Alert>
      {integrations && (
        <div className="grid gap-4 sm:grid-cols-2">
          {integrations.map((i) => <PlatformCard key={i.platform} integration={i} onChanged={load} />)}
        </div>
      )}
    </div>
  );
};

export default IntegrationsPage;
