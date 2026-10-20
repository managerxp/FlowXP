/*
 * The two printed papers of an event. ?doc=beo is the banquet event order: one page the kitchen, the floor and the decorators work from (functions, times, set-up, guests,
 * menu, instructions, contacts). ?doc=proforma is the provisional invoice with GST line by line, for the organiser. Both are plain pages meant for the browser's Print.
 */
import { useSearchParams, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { eventTypeName, hhmm, longDate, setupName, useLoad } from '../../lib/hotel.js';
import { Button, ListState } from '../../components/ui.jsx';
import { useT } from '../../i18n/useT.js';

const rs = (p) => formatCurrency((p || 0) / 100);

export default function BanquetPrint() {
  const tr = useT();
  const { id } = useParams();
  const [params] = useSearchParams();
  const doc = params.get('doc') === 'proforma' ? 'proforma' : 'beo';
  const { business } = useAuth();
  const ev = useLoad(`/hotel/banquet/events/${id}`);
  const pf = useLoad(doc === 'proforma' ? `/hotel/banquet/events/${id}/proforma` : null);
  const e = ev.data;
  if (!e) return <ListState loading={ev.loading} error={ev.error} />;
  const address = [business?.address, business?.city, business?.state].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end print:hidden"><Button onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />{tr('Print')}</Button></div>
      <article className="rounded-(--radius-card) border border-line bg-surface p-8 text-small text-ink-900 print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-ink-900 pb-4">
          <div><p className="text-lg font-semibold">{business?.name}</p><p className="text-caption text-ink-500">{address}</p>{business?.gstin && <p className="text-caption text-ink-500">{tr('GSTIN {{gstin}}', { gstin: business.gstin })}</p>}</div>
          <div className="text-right"><p className="text-lg font-semibold uppercase tracking-wide">{doc === 'beo' ? tr('Banquet event order') : tr('Proforma invoice')}</p><p className="text-caption text-ink-500">{e.event_no} · {e.status === 'COMPLETED' ? tr('Completed') : e.status.charAt(0) + e.status.slice(1).toLowerCase()}</p></div>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-4">
          <div><p className="text-caption font-semibold uppercase text-ink-500">{tr('Event')}</p><p className="text-base font-semibold">{tr(e.title)}</p><p>{eventTypeName(e.event_type)}</p></div>
          <div><p className="text-caption font-semibold uppercase text-ink-500">{tr('Organiser')}</p><p className="font-semibold">{e.guest.name}</p><p>{e.guest.phone}{e.guest.email ? ` · ${e.guest.email}` : ''}</p>{(e.company || e.guest.company) && <p>{e.company || e.guest.company}</p>}{e.guest.gstin && <p>{tr('GSTIN {{gstin}}', { gstin: e.guest.gstin })}</p>}</div>
        </section>

        {doc === 'beo' ? (
          <>
            {e.functions.map((f, i) => (
              <section key={f.function_id} className="mt-6 break-inside-avoid border-t border-line pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold">{i + 1}. {f.name}</h2><p className="font-medium">{tr('{{longDate}}, {{hhmm}} to {{hhmm2}}', { longDate: longDate(String(f.event_date).slice(0, 10)), hhmm: hhmm(f.start_time), hhmm2: hhmm(f.end_time) })}</p></div>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
                  <div className="flex justify-between"><dt className="text-ink-500">{tr('Hall')}</dt><dd className="font-medium">{f.hall_name}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">{tr('Set-up')}</dt><dd className="font-medium">{setupName(f.setup_style)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">{tr('Guests expected')}</dt><dd className="font-medium">{f.expected_guests}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">{tr('Guests guaranteed')}</dt><dd className="font-medium">{f.guaranteed_guests ?? 'Not given yet'}</dd></div>
                  {f.package_name && <div className="col-span-2 flex justify-between"><dt className="text-ink-500">{tr('Menu package')}</dt><dd className="font-medium">{f.package_name}</dd></div>}
                </dl>
                {f.menu && <div className="mt-3"><p className="text-caption font-semibold uppercase text-ink-500">{tr('Menu')}</p><p className="whitespace-pre-line">{f.menu}</p></div>}
                {f.setup_notes && <div className="mt-3"><p className="text-caption font-semibold uppercase text-ink-500">{tr('Set-up notes')}</p><p className="whitespace-pre-line">{f.setup_notes}</p></div>}
              </section>
            ))}
            {e.instructions && <section className="mt-6 break-inside-avoid border-t border-line pt-4"><p className="text-caption font-semibold uppercase text-ink-500">{tr('Instructions for the team')}</p><p className="mt-1 whitespace-pre-line">{e.instructions}</p></section>}
            <section className="mt-6 break-inside-avoid border-t border-line pt-4">
              <p className="text-caption font-semibold uppercase text-ink-500">{tr('Money')}</p>
              <p>{tr('Total {{rs}} with GST · paid {{rs2}} · balance {{rs3}}', { rs: rs(e.totals.charges_paise), rs2: rs(e.totals.paid_paise), rs3: rs(e.totals.balance_paise) })}</p>
            </section>
            <footer className="mt-10 grid grid-cols-3 gap-6 text-caption text-ink-500">{['Banquet manager', 'Kitchen', 'Organiser'].map((x) => <div key={x} className="border-t border-ink-400 pt-1.5">{x}</div>)}</footer>
          </>
        ) : !pf.data ? <ListState loading={pf.loading} error={pf.error} /> : (
          <>
            <section className="mt-6">
              <table className="w-full text-left">
                <thead><tr className="border-b border-ink-900 text-caption uppercase text-ink-500"><th className="py-1.5 font-semibold">{tr('Description')}</th><th className="py-1.5 text-right font-semibold">{tr('Qty')}</th><th className="py-1.5 text-right font-semibold">{tr('Rate')}</th><th className="py-1.5 text-right font-semibold">{tr('Amount')}</th><th className="py-1.5 text-right font-semibold">{tr('GST')}</th><th className="py-1.5 text-right font-semibold">{tr('Total')}</th></tr></thead>
                <tbody>{pf.data.lines.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-1.5 pr-2">{tr(l.description)}</td><td className="py-1.5 text-right tabular">{l.quantity}</td><td className="py-1.5 text-right tabular">{rs(l.unit_price_paise)}</td><td className="py-1.5 text-right tabular">{rs(l.amount_paise)}</td><td className="py-1.5 text-right tabular">{rs(l.tax_paise)} <span className="text-caption text-ink-500">({l.tax_rate}%)</span></td><td className="py-1.5 text-right tabular font-medium">{rs(l.total_paise)}</td></tr>)}</tbody>
              </table>
              <dl className="ml-auto mt-4 max-w-xs space-y-1">
                <div className="flex justify-between"><dt className="text-ink-500">{tr('Before GST')}</dt><dd className="tabular">{rs(pf.data.totals.net_paise)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">{tr('GST')}</dt><dd className="tabular">{rs(pf.data.totals.tax_paise)}</dd></div>
                <div className="flex justify-between border-t border-ink-900 pt-1 text-base font-semibold"><dt>{tr('Total')}</dt><dd className="tabular">{rs(pf.data.totals.charges_paise)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">{tr('Advance and payments')}</dt><dd className="tabular">−{rs(pf.data.totals.paid_paise)}</dd></div>
                <div className="flex justify-between text-base font-semibold"><dt>{tr('Balance')}</dt><dd className="tabular">{rs(pf.data.totals.balance_paise)}</dd></div>
              </dl>
            </section>
            <p className="mt-8 text-caption text-ink-500">{tr('This is a provisional invoice for the event as booked. The final GST tax invoice is made when the event is completed, and may change if the guest count or charges change.')}</p>
          </>
        )}
      </article>
    </div>
  );
}
