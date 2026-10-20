import { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { currentBusiness, useSession, api } from '../../lib/session.ts';
import { allowed } from '../../lib/access.ts';
import { t } from '../../lib/i18n.ts';
import { rupees } from '../../lib/money.ts';
import { Card, Field, Input, Msg, Panel, SetupShell, confirm, useAct, useList } from '../../lib/formKit.tsx';
import {
  JOB_STATUS_LABEL, PAY_METHODS, billBody, billProblem, canBill, canJobCards, estimateLines, isLive, labourBody, labourProblem, lineSub, lineText, misfits, quantityProblem, stepsFor, vehicleOf, type JobFull
} from '../../lib/jobCards.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, color, s } from '../../lib/ui.tsx';

type Found = { product_id: number; name: string; sku: string | null; selling_price_paise: number; stock?: number };

/** Search the catalogue and tap a part to put it on the card. A shortage is said plainly and can be accepted. */
const AddPart = ({ jobId, done }: { jobId: string; done: () => void }) => {
  const [text, setText] = useState(''); const [rows, setRows] = useState<Found[]>([]);
  const a = useAct();
  useEffect(() => {
    if (text.trim().length < 2) { setRows([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => { void api.get<Found[]>(`/autoparts/parts/lookup?q=${encodeURIComponent(text.trim())}&limit=6`).then((r) => { if (live) setRows(r); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  const add = async (p: Found, allow = false): Promise<void> => {
    try { await api.post(`/autoparts/jobcards/${jobId}/lines`, { kind: 'PART', product_id: p.product_id, quantity: 1, ...(allow ? { allow_short: true } : {}) }); setText(''); setRows([]); done(); }
    catch (e) {
      const msg = (e as Error).message;
      if (/free to hold/.test(msg)) confirm(t('Not enough in stock'), `${msg}. ${t('Add it to the card anyway, without holding it?')}`, 'Add anyway', () => { void add(p, true); });
      else a.setError(msg);
    }
  };
  return (
    <>
      <Field label="Add a part"><TextInput style={s.input} value={text} onChangeText={setText} placeholder={t('Add a part: name, code or part number')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Add a part')} /></Field>
      {rows.map((p) => <Line key={p.product_id} left={p.name} sub={[p.sku || '', rupees(p.selling_price_paise), p.stock != null ? t('{n} in stock', { n: p.stock }) : ''].filter(Boolean).join(' · ')} onPress={() => { void add(p); }} />)}
      <Msg a={a} />
    </>
  );
};

/* One job card: the vehicle and customer, the parts and labour with a fitment warning, the estimate, and the way to the bill. */
export default function JobCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = currentBusiness(useSession());
  const job = useList<JobFull>(`/autoparts/jobcards/${id}`);
  const [labour, setLabour] = useState({ description: '', price: '' });
  const [pay, setPay] = useState({ method: 'CASH', amount: '' });
  const [qty, setQty] = useState<{ id: number; v: string } | null>(null);
  const a = useAct();
  const j = job.data;
  const body = !j ? (job.error ? <Failed message={job.error} onRetry={job.reload} /> : <Loading />) : (() => {
    const live = isLive(j.status);
    const bad = misfits(j.lines);
    return (
      <Panel>
        <SectionTitle>{`${j.job_no} · ${t(JOB_STATUS_LABEL[j.status] ?? j.status)}`}</SectionTitle>
        <Soft>{[vehicleOf(j), j.odometer_km != null ? `${j.odometer_km} km` : '', j.earlier_visits ? `${j.earlier_visits} ${t('earlier visits')}` : ''].filter(Boolean).join(' · ')}</Soft>
        <Soft>{[j.customer_name, j.customer_phone].filter(Boolean).join(' · ')}</Soft>
        {j.complaint ? <Text style={{ color: color.ink }}>{j.complaint}</Text> : null}
        {bad.length ? <Text accessibilityRole="alert" style={{ color: color.danger, fontWeight: '600' }}>{`${t('Warning: this part is recorded as not fitting the vehicle')}: ${bad.join(', ')}`}</Text> : null}
        {live ? stepsFor(j.status).map((st) => <Button key={st.status} title={st.label} kind="quiet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.post(`/autoparts/jobcards/${id}/status`, { status: st.status }); job.reload(); }, 'Saved'); }} />) : null}

        <SectionTitle>Parts</SectionTitle>
        {j.lines.length === 0 ? <Soft>{t('Nothing on the card yet.')}</Soft> : null}
        {j.lines.map((l) => (
          <Card key={l.line_id}>
            <Text style={{ color: color.ink, fontWeight: '600' }}>{lineText(l)}</Text>
            <Soft>{lineSub(l)}</Soft>
            {live ? (
              <>
                <Input label="Quantity" numeric value={qty?.id === l.line_id ? qty.v : String(l.quantity)} onChange={(v) => setQty({ id: l.line_id, v })} max={8} />
                {qty?.id === l.line_id && qty.v !== String(l.quantity) ? <Button title="Save" busy={a.busy} onPress={() => { void a.run(quantityProblem(qty.v), async () => { await api.call(`/autoparts/jobcards/lines/${l.line_id}`, { method: 'PUT', body: { quantity: Number(qty.v) } }); setQty(null); job.reload(); }); }} /> : null}
                <Button title="Remove" kind="danger" onPress={() => confirm(t('Remove {name}?', { name: l.description }), '', 'Remove', () => { void a.run('', async () => { await api.call(`/autoparts/jobcards/lines/${l.line_id}`, { method: 'DELETE', body: {} }); job.reload(); }, 'Saved'); })} />
              </>
            ) : null}
          </Card>
        ))}
        {live ? (
          <>
            <AddPart jobId={String(id)} done={job.reload} />
            <SectionTitle>Add labour</SectionTitle>
            <Input label="What was done" value={labour.description} onChange={(v) => setLabour({ ...labour, description: v })} max={200} />
            <Input label="Charge" numeric value={labour.price} onChange={(v) => setLabour({ ...labour, price: v })} max={9} />
            <Button title="Add" kind="quiet" busy={a.busy} onPress={() => { void a.run(labourProblem(labour.description, labour.price), async () => { await api.post(`/autoparts/jobcards/${id}/lines`, labourBody(labour.description, labour.price)); setLabour({ description: '', price: '' }); job.reload(); }); }} />
          </>
        ) : null}
        <Card>{estimateLines(j.estimate).map(([k, v]) => <Text key={k} style={{ color: color.ink, fontWeight: k === t('Estimate') ? '700' : '400' }}>{`${k}: ${v}`}</Text>)}</Card>
        <Msg a={a} />

        {canBill(j) && allowed(me, 'billing') ? (
          <Card>
            <Field label="Customer pays"><Chips items={PAY_METHODS.map((m) => ({ id: m.id, label: t(m.label) }))} value={pay.method} onChange={(v) => setPay({ ...pay, method: v })} /></Field>
            {pay.method !== 'CREDIT' ? <Input label="Amount" hint="Blank: the whole bill" numeric value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} max={9} /> : null}
            <Button title="Make the bill" busy={a.busy} onPress={() => { void a.run(billProblem(pay.method, pay.amount), async () => { const out = await api.post<{ invoice: { invoice_id: number } }>(`/autoparts/jobcards/${id}/bill`, billBody(pay.method, pay.amount)); job.reload(); router.push({ pathname: '/receipt', params: { id: String(out.invoice.invoice_id) } }); }, 'Bill made'); }} />
          </Card>
        ) : null}
        {j.status === 'BILLED' && j.invoice_id ? <Button title="Open the bill" onPress={() => router.push({ pathname: '/receipt', params: { id: String(j.invoice_id) } })} /> : null}
        {live ? <Button title="Cancel the job" kind="danger" onPress={() => confirm(t('Cancel this job?'), t('Every part held for it goes back on the shelf.'), 'Cancel the job', () => { void a.run('', async () => { await api.post(`/autoparts/jobcards/${id}/status`, { status: 'CANCELLED' }); job.reload(); }, 'Saved'); })} /> : null}
      </Panel>
    );
  })();
  return (
    <SetupShell title="Job card" sub={j ? vehicleOf(j) : ' '} ok={canJobCards((p) => allowed(me, p))} denied="You do not have access to job cards.">
      {body}
    </SetupShell>
  );
}
