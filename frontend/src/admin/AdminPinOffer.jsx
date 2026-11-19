/*
 * Shown to a staff member who has just signed in with an emailed code: set a 4 digit PIN for this computer, so next time it is only their email or phone number and the PIN.
 * Asked once per computer ("Not now" is remembered), and not at all when this computer already has a PIN for them.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Alert, Button, Card, Input, useToast } from '../components/ui.jsx';

const SKIP = 'flowxp.admin.pin.skip';
const skipped = () => { try { return localStorage.getItem(SKIP) === '1'; } catch { return false; } };

const AdminPinOffer = () => {
  const { admin } = useAdminAuth();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const staff = admin && admin.role !== 'OWNER';

  useEffect(() => {
    if (!staff || skipped()) return;
    adminApi('/pin').then((r) => setShow(!r.has_pin)).catch(() => {});
  }, [staff]);

  if (!show) return null;
  const save = async (e) => {
    e.preventDefault(); setError('');
    try { await adminApi('/pin', { method: 'POST', body: { pin } }); toast.success('PIN set. Next time sign in with it on this computer.'); setShow(false); }
    catch (err) { setError(err.message); }
  };
  const later = () => { try { localStorage.setItem(SKIP, '1'); } catch { /* it just asks again */ } setShow(false); };

  return (
    <Card className="mb-6 border-brand-500">
      <p className="text-small font-semibold text-ink-900">Sign in faster on this computer</p>
      <p className="mt-1 text-small text-ink-700">Set a 4 digit PIN. Next time you only type your email or phone number and the PIN. It works on this computer only.</p>
      <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
        <Input aria-label="New PIN" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="4 digits" className="!w-32" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
        <Button size="sm" disabled={pin.length !== 4}>Set PIN</Button>
        <Button size="sm" type="button" variant="ghost" onClick={later}>Not now</Button>
      </form>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </Card>
  );
};

export default AdminPinOffer;
