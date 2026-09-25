/*
 * The floor: every dining table, its occupancy, and the QR code a customer
 * scans to order from their own phone (see publicOrdering.controller.js and
 * public/CustomerMenu.jsx — that page is the QR's destination).
 *
 * Occupancy is never a separate flag here — a table's open_order_id/
 * open_order_number come straight from tables.controller.js's derivation
 * ("does this table have a running order"), so this screen can't drift out
 * of sync with Orders the way a manually-toggled "occupied" checkbox would.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';
import { PageHeader, Card, Badge, Button, Modal, Field, Input, Alert, ListState, SkeletonCards } from '../components/ui.jsx';

const STATUS_TONE = { FREE: 'success', RESERVED: 'warning', CLEANING: 'neutral' };

const AddTableModal = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [seats, setSeats] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) { setError('Enter a table name or number'); return; }
    setBusy(true); setError('');
    try {
      const table = await api('/tables', { method: 'POST', body: { name, zone: zone || undefined, seats: seats ? Number(seats) : undefined } });
      onCreated(table);
    } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Add table" onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="table-name" label="Name or number"><Input id="table-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Table 4" autoFocus /></Field>
        <Field id="table-zone" label="Zone (optional)"><Input id="table-zone" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Patio" /></Field>
        <Field id="table-seats" label="Seats (optional)"><Input id="table-seats" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        <Button onClick={create} disabled={busy} className="w-full">{busy ? 'Adding…' : 'Add table'}</Button>
      </div>
    </Modal>
  );
};

const QrModal = ({ table, onClose }) => {
  const [dataUrl, setDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/order/${table.qr_token}`;

  useEffect(() => { QRCode.toDataURL(link, { width: 320, margin: 1 }).then(setDataUrl); }, [link]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal title={`QR for ${table.name}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? <img src={dataUrl} alt={`QR code to order from ${table.name}`} className="h-56 w-56" /> : <div className="h-56 w-56 animate-pulse rounded-lg bg-surface-3" />}
        <div className="w-full">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Quick link</p>
          <p className="truncate rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-700">{link}</p>
        </div>
        <div className="flex w-full gap-2">
          <Button variant="secondary" onClick={copyLink} className="flex-1">{copied ? 'Copied' : 'Copy link'}</Button>
          {dataUrl && (
            <a href={dataUrl} download={`table-${table.name}-qr.png`} className="flex-1">
              <Button as="span" className="w-full">Download QR</Button>
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
};

const TablesPage = () => {
  const navigate = useNavigate();
  const [tables, setTables] = useState(null);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [qrTable, setQrTable] = useState(null);

  const load = () => api('/tables').then(setTables).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Tables" lead="Your floor, and the QR code each table's customers order from." action={<Button onClick={() => setShowAdd(true)}>Add table</Button>} />

      <ListState
        loading={!tables && !error}
        error={error}
        empty={tables?.length === 0}
        emptyLabel="No tables yet — add your first one above."
        skeleton={<SkeletonCards count={6} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tables?.map((t) => (
          <Card key={t.table_id}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-ink-900">{t.name}</p>
                {t.zone && <p className="text-xs text-ink-400">{t.zone}</p>}
              </div>
              <Badge tone={t.open_order_id ? 'brand' : STATUS_TONE[t.status]}>{t.open_order_id ? 'Occupied' : t.status}</Badge>
            </div>
            {t.seats && <p className="mt-2 text-xs text-ink-500">{t.seats} seats</p>}
            {t.next_reservation && !t.open_order_id && <p className="mt-1 text-xs font-medium text-amber-600">Booked {new Date(t.next_reservation.reserved_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {t.next_reservation.guest_name} ({t.next_reservation.party_size})</p>}
            <div className="mt-4 flex gap-2">
              {t.open_order_id ? (
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => navigate('/app/orders')}>
                  View order
                </Button>
              ) : (
                <Button size="sm" variant="secondary" className="flex-1" disabled>Free</Button>
              )}
              <Button size="sm" className="flex-1" onClick={() => setQrTable(t)}>View QR</Button>
            </div>
          </Card>
        ))}
      </div>

      {showAdd && <AddTableModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />}
      {qrTable && <QrModal table={qrTable} onClose={() => setQrTable(null)} />}
    </div>
  );
};

export default TablesPage;
