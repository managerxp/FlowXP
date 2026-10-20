/*
 * A printed membership card. The QR holds a random code and nothing else: no name, no phone, no plan. The code is only known at the moment the card is
 * made (the server keeps just a fingerprint of it), so this page is reached straight from "Make a card" and cannot be opened again later: to reprint,
 * replace the card, which cancels the old one.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useAuth } from '../../context/AuthContext.jsx';
import { Alert, Button, PageHeader } from '../../components/ui.jsx';
import { useT } from '../../i18n/useT.js';

export default function CardPrint() {
  const tr = useT();
  const { id } = useParams();
  const { state } = useLocation();
  const { business } = useAuth();
  const [src, setSrc] = useState('');
  useEffect(() => { if (state?.code) QRCode.toDataURL(state.code, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc); }, [state?.code]);

  if (!state?.code) {
    return (
      <div>
        <PageHeader title={tr('Membership card')} />
        <Alert>{tr('The code for a card is shown only once, when it is made, so it cannot be opened again. To print one, go to the member and choose Replace card: the old card stops working and a new one is made.')}</Alert>
        <Button className="mt-4" to={`/app/gym/members/${id}`} variant="secondary">{tr('Back to the member')}</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title={tr('Print the card')} lead={tr('Print it now. This code cannot be shown again.')} action={<><Button variant="secondary" to={`/app/gym/members/${id}`}>{tr('Done')}</Button><Button onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />{tr('Print')}</Button></>} />
        <p className="mb-4 max-w-xl text-small text-ink-500">{tr('Card size 85 × 54 mm. The QR carries no personal details, so a lost card tells a finder nothing, but anyone holding it can show it at the door: replace it if it goes missing.')}</p>
      </div>
      <style>{'@media print { @page { size: 85.6mm 54mm; margin: 0 } body { background: #fff } }'}</style>
      <div className="light-sheet mx-auto flex h-[54mm] w-[85.6mm] items-stretch overflow-hidden rounded-xl border border-line bg-white text-ink-900 print:rounded-none print:border-0">
        <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
          <div><p className="truncate text-sm font-bold leading-tight text-brand-700">{business?.name}</p><p className="text-[10px] uppercase tracking-wider text-ink-500">{tr('Member')}</p></div>
          <div><p className="truncate text-base font-semibold leading-tight">{state.name}</p><p className="tabular text-xs text-ink-700">{state.memberCode}</p></div>
        </div>
        <div className="flex w-[40mm] items-center justify-center bg-white p-2">{src && <img src={src} alt={tr('QR code for {{state_name}}', { state_name: state.name })} className="h-full w-full object-contain" />}</div>
      </div>
      <p className="mt-4 text-center text-caption text-ink-500 print:hidden"><Link to={`/app/gym/members/${id}`} className="text-brand-600 hover:underline">{tr('Back to the member')}</Link></p>
    </div>
  );
}
