/*
 * Settings → Business → Start fresh. Owner only (the page is), and shown only while the shop is on its free trial and has never paid:
 * wipes the practice bills, orders, purchases, expenses and stock history so real work starts at bill number 1. Products, customers,
 * staff and settings stay. The word START FRESH must be typed, the backend checks the trial again.
 */
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, Card, useDialog, useToast } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const StartFreshSettings = () => {
  const tr = useT();
  const { prompt } = useDialog();
  const toast = useToast();
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/businesses/current/start-fresh').then((d) => setAllowed(!!d.allowed)).catch(() => {}); }, []);
  if (!allowed) return null;

  const run = async () => {
    const typed = await prompt({ title: tr('Start fresh?'), body: tr('This deletes every bill, order, payment, purchase, expense and stock movement made so far, and cannot be undone. Products, customers, staff and settings stay. Stock goes back to 0 so you can count it again.'),
      label: tr('Type START FRESH to confirm'), confirmLabel: tr('Delete and start fresh'), danger: true });
    if (!typed) return;
    setError('');
    try { await api('/businesses/current/start-fresh', { method: 'POST', body: { confirm: typed } }); toast.success(tr('Your trial data is cleared. Numbering starts again from 1.')); }
    catch (caught) { setError(caught.message); }
  };

  return (
    <Card className="mt-6">
      <h3 className="text-base font-bold text-ink-900">{tr('Start fresh')}</h3>
      <p className="mt-1 text-sm text-ink-500">{tr('Done trying FlowXP? Clear the practice bills and stock history and begin real work from bill number 1. Only possible during the free trial.')}</p>
      <Alert>{error}</Alert>
      <Button type="button" variant="danger" className="mt-4" onClick={run}><RotateCcw className="h-4 w-4" aria-hidden="true" /> {tr('Start fresh')}</Button>
    </Card>
  );
};

export default StartFreshSettings;
