/*
 * Settings → Mechanic mode (spare parts shops, owner only). On: the menu shows Job cards, Labour and services, What we earned, and Staff and payroll. Off: a shop that only
 * sells parts does not see them. Nothing is deleted either way; turning it off only hides the screens (backend: PUT /businesses/current/workshop-mode).
 */
import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Card, useToast } from '../components/ui.jsx';
import { Toggle } from './salon/parts.jsx';
import { useT } from '../i18n/useT.js';

const MechanicModeSettings = () => {
  const tr = useT();
  const { business, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (business?.business_type !== 'AUTO_PARTS') return null;
  const on = business.workshop_mode !== false;
  const change = async (enabled) => {
    setBusy(true); setError('');
    try {
      await api('/businesses/current/workshop-mode', { method: 'PUT', body: { enabled } });
      await refresh();
      toast.success(enabled ? tr('Mechanic mode is on') : tr('Mechanic mode is off'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Card className="mt-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink-900"><Wrench aria-hidden="true" className="h-4 w-4" /> {tr('Mechanic mode')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('Turn this on if you also service bikes or cars. Turn it off if you only sell parts. You can change it any time, and nothing is deleted.')}</p>
      <div className="mt-4 space-y-3">
        <Alert>{error}</Alert>
        <Toggle id="mechanic-mode" checked={on} disabled={busy} onChange={change} label={tr('This shop also does servicing')} hint={tr('On: Job cards, labour and services, what the workshop earned, and staff, attendance and payroll appear in the menu.')} />
        <p className="text-caption text-ink-500">{tr('Racks, parts, vehicles, receiving, trade accounts and reports stay either way.')}</p>
      </div>
    </Card>
  );
};

export default MechanicModeSettings;
