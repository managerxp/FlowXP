import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { rupees } from '../lib/money.ts';
import { Card, Field, Input, Msg, Panel, SetupShell, useAct, useList } from '../lib/formKit.tsx';
import { IN_KINDS, MONEY_METHODS, OUT_KINDS, PERIODS, emptyMoney, entryAmount, entrySub, moneyProblem, moneyRequest, rangeFor, type MoneyBook, type MoneyEntry, type MoneyForm } from '../lib/garage.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, color, s } from '../lib/ui.tsx';

type Cust = { customer_id: number; name: string; phone: string | null };

/** Find the customer who paid, by name or phone. */
const CustomerPick = ({ form, set }: { form: MoneyForm; set: (patch: Partial<MoneyForm>) => void }) => {
  const [text, setText] = useState(''); const [rows, setRows] = useState<Cust[]>([]);
  useEffect(() => {
    if (text.trim().length < 2) { setRows([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => { void api.get<Cust[]>(`/customers?search=${encodeURIComponent(text.trim())}&limit=6`).then((r) => { if (live && Array.isArray(r)) setRows(r); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  if (form.customer_id) return <Field label="Customer"><Line left={form.customer_name} sub={t('Change')} onPress={() => set({ customer_id: null, customer_name: '' })} /></Field>;
  return (
    <>
      <Field label="Customer"><TextInput style={s.input} value={text} onChangeText={setText} placeholder={t('Customer name or phone')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Customer name or phone')} /></Field>
      {rows.map((c) => <Line key={c.customer_id} left={c.name} sub={c.phone ?? ''} onPress={() => set({ customer_id: c.customer_id, customer_name: c.name })} />)}
    </>
  );
};

const Entries = ({ title, total, rows, tone }: { title: string; total: number; rows: MoneyEntry[]; tone: string }) => (
  <>
    <SectionTitle>{`${t(title)}: ${rupees(total)}`}</SectionTitle>
    {rows.length === 0 ? <Soft style={{ paddingHorizontal: 16 }}>{t('Nothing yet.')}</Soft> : rows.map((e) => <Line key={`${e.kind}${e.ref_id}`} left={e.who} sub={entrySub(e)} right={entryAmount(e)} icon={tone === 'in' ? 'arrow-down-outline' : 'arrow-up-outline'} />)}
  </>
);

/* Money In and Money Out: two plain lists for the day, the week or the month, and one big button for each. */
export default function MoneyScreen() {
  const me = currentBusiness(useSession());
  const ok = allowed(me, 'payments', 'expenses');
  const [period, setPeriod] = useState('today');
  const [form, setForm] = useState<{ dir: 'in' | 'out'; f: MoneyForm } | null>(null);
  const r = rangeFor(period);
  const book = useList<MoneyBook>(`/autoparts/garage/money?from=${r.from}&to=${r.to}`);
  const a = useAct();
  const set = (patch: Partial<MoneyForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  const d = book.data;
  return (
    <SetupShell title="Money In and Out" sub="Every rupee that came in and went out." ok={ok} denied="You do not have access to this.">
      <Panel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Money In" onPress={() => { a.setError(''); setForm({ dir: 'in', f: emptyMoney('in') }); }} style={{ flex: 1, minHeight: 56 }} />
          <Button title="Money Out" kind="quiet" onPress={() => { a.setError(''); setForm({ dir: 'out', f: emptyMoney('out') }); }} style={{ flex: 1, minHeight: 56 }} />
        </View>
        {form ? (
          <Card>
            <SectionTitle>{form.dir === 'in' ? 'What came in?' : 'What went out?'}</SectionTitle>
            {form.dir === 'in' ? <Chips items={[{ id: 'CUSTOMER', label: t('Customer payment') }, { id: 'OTHER_IN', label: t('Other money in') }]} value={form.f.kind} onChange={(k) => set({ kind: k as MoneyForm['kind'], category: IN_KINDS[0] })} /> : null}
            {form.f.kind === 'CUSTOMER' ? <CustomerPick form={form.f} set={set} /> : (
              <Field label="For what?"><Chips items={(form.dir === 'in' ? IN_KINDS : OUT_KINDS).map((k) => ({ id: k, label: t(k) }))} value={form.f.category} onChange={(v) => set({ category: v })} /></Field>
            )}
            <Input label="Amount" numeric value={form.f.amount} onChange={(v) => set({ amount: v })} max={9} />
            <Field label="How was it paid?"><Chips items={MONEY_METHODS.map((m) => ({ id: m.id, label: t(m.label) }))} value={form.f.method} onChange={(v) => set({ method: v })} /></Field>
            <Input label="Note (if you like)" value={form.f.note} onChange={(v) => set({ note: v })} max={200} />
            <Msg a={a} />
            <Button title="Save" busy={a.busy} onPress={() => { void a.run(moneyProblem(form.f), async () => { const q = moneyRequest(form.f); await api.post(q.path, q.body); setForm(null); book.reload(); }); }} />
            <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
          </Card>
        ) : null}
        <Chips items={PERIODS.map((p) => ({ id: p.id, label: t(p.label) }))} value={period} onChange={setPeriod} />
        {book.error && !d ? <Failed message={book.error} onRetry={book.reload} /> : !d ? <Loading /> : (
          <>
            <Text style={{ color: d.net_paise >= 0 ? color.ok : color.warn, fontWeight: '700' }}>{`${t('Left over')}: ${rupees(d.net_paise)}`}</Text>
            <Soft>{`${t('Cash left over')}: ${rupees(d.cash_net_paise)}`}</Soft>
            <Entries title="Money In" total={d.in.total_paise} rows={d.in.entries} tone="in" />
            <Entries title="Money Out" total={d.out.total_paise} rows={d.out.entries} tone="out" />
          </>
        )}
      </Panel>
    </SetupShell>
  );
}
