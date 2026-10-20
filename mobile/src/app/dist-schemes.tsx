import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Multi, Panel, Row, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import {
  CUSTOMER_TYPE_CHOICES, SCHEME_KIND_LABEL, SCOPE_LABEL, announceText, emptyScheme, schemeBody, schemeForm, schemeProblem, schemeSub, type SchemeForm, type SchemeFull, type SchemeRow
} from '../lib/distributorSales.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, color, s } from '../lib/ui.tsx';

type Found = { product_id: number; name: string };

/** Search products by name and tap one. */
const ProductFind = ({ label, chosen, onPick, onClear }: { label: string; chosen: string; onPick: (id: number, name: string) => void; onClear: () => void }) => {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => { void api.get<Found[]>(`/wholesale/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r.slice(0, 8)); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  if (chosen) return <Field label={label}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, color: color.ink, fontWeight: '600' }}>{chosen}</Text><Button title="Change" kind="quiet" onPress={onClear} /></View></Field>;
  return (
    <Field label={label}>
      <TextInput style={s.input} value={text} onChangeText={setText} placeholder={t('Name or barcode')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
      {found.map((p) => <Pressable key={p.product_id} accessibilityRole="button" onPress={() => { onPick(p.product_id, p.name); setText(''); setFound([]); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: color.brand, fontWeight: '600' }}>{p.name}</Text></Pressable>)}
    </Field>
  );
};

/* Schemes: free goods and discounts for shops, who gets them and when. */
export default function SchemesScreen() {
  const me = currentBusiness(useSession());
  const edit = allowed(me, 'schemes');
  const [status, setStatus] = useState('ACTIVE');
  const list = useList<SchemeRow[]>(`/distributor/schemes?status=${status}&limit=100`);
  const principals = useList<{ principal_id: number; name: string }[]>('/distributor/principals?status=ALL&limit=200');
  const brands = useList<{ brand_id: number; name: string }[]>('/distributor/brands');
  const cats = useList<{ category_id: number; name: string }[]>('/wholesale/categories');
  const [form, setForm] = useState<{ id?: number; f: SchemeForm } | null>(null);
  const [open, setOpen] = useState<SchemeRow | null>(null);
  const a = useAct();
  const set = (patch: Partial<SchemeForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  const scopeChoices = form?.f.scope === 'BRAND' ? (brands.data ?? []).map((b) => ({ id: String(b.brand_id), label: b.name })) : form?.f.scope === 'CATEGORY' ? (cats.data ?? []).map((c) => ({ id: String(c.category_id), label: c.name })) : form?.f.scope === 'PRINCIPAL' ? (principals.data ?? []).map((p) => ({ id: String(p.principal_id), label: p.name })) : [];
  const principalChoices = [{ id: '', label: t('None') }, ...(principals.data ?? []).map((p) => ({ id: String(p.principal_id), label: p.name }))];
  const load = async (x: SchemeRow) => { a.setError(''); try { const full = await api.get<SchemeFull>(`/distributor/schemes/${x.scheme_id}`); setForm({ id: x.scheme_id, f: schemeForm(full) }); setOpen(null); } catch (e) { a.setError((e as Error).message); } };
  const done = () => { setForm(null); setOpen(null); list.reload(); };
  return (
    <SetupShell title="Schemes" sub="Free goods and discounts for shops: who gets them, when, and what they cost" ok={allowed(me, 'schemes', 'sales_orders', 'field_sales', 'reports')} denied="You do not have access to schemes.">
      <Chips items={[{ id: 'ACTIVE', label: 'Running' }, { id: 'UPCOMING', label: 'Starts soon' }, { id: 'EXPIRED', label: 'Ended' }, { id: 'INACTIVE', label: 'Switched off' }, { id: 'ALL', label: 'All' }]} value={status} onChange={setStatus} />
      {list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <Panel>
          {edit ? <Button title="New scheme" onPress={() => { a.setError(''); setOpen(null); setForm({ f: emptyScheme() }); }} /> : null}
          {list.data.length === 0 ? <Soft>{t('Make an offer: buy 10 cartons, get 1 free; 5% off 100 units; ₹2,000 off an order above ₹50,000.')}</Soft> : null}
          {list.data.map((x) => <Line key={x.scheme_id} left={x.name} sub={`${t(x.description)} · ${schemeSub(x)}`} onPress={() => { setForm(null); a.setError(''); a.setNote(''); setOpen(x); }} />)}
          {open ? (
            <Card>
              <SectionTitle>{open.name}</SectionTitle>
              <Soft>{t(open.description)}</Soft>
              <Soft>{schemeSub(open)}</Soft>
              <Msg a={a} />
              {edit ? (
                <>
                  <Button title="Edit" onPress={() => { void load(open); }} />
                  <Button title={open.is_active ? 'Switch off' : 'Switch on'} kind="quiet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.call(`/distributor/schemes/${open.scheme_id}`, { method: 'PUT', body: { is_active: !open.is_active } }); done(); }, open.is_active ? 'Switched off' : 'Switched on'); }} />
                  {open.status === 'ACTIVE' ? <Button title="Tell the shops" kind="quiet" busy={a.busy} onPress={() => confirm(t('Tell qualifying shops?'), t('A message goes out through your messaging channel to every shop that qualifies. Those who opted out are skipped.'), 'Send', () => { void (async () => { try { const r = await api.post<{ sent: number; qualifying: number; skipped?: number }>(`/distributor/schemes/${open.scheme_id}/announce`, {}); a.setNote(announceText(r)); } catch (e) { a.setError((e as Error).message); } })(); })} /> : null}
                  <Button title="Delete" kind="danger" onPress={() => confirm(t('Delete {name}?', { name: open.name }), t('A scheme that orders have used can only be switched off.'), 'Delete', () => { void a.run('', async () => { await api.call(`/distributor/schemes/${open.scheme_id}`, { method: 'DELETE', body: {} }); done(); }, 'Deleted'); })} />
                </>
              ) : null}
              <Button title="Close" kind="quiet" onPress={() => setOpen(null)} />
            </Card>
          ) : null}
          {form ? (
            <Card>
              <Input label="Scheme name" value={form.f.name} onChange={(v) => set({ name: v })} max={120} placeholder="Buy 10 cartons, get 1 free" />
              <Field label="Type"><Chips items={Object.entries(SCHEME_KIND_LABEL).map(([id, label]) => ({ id, label }))} value={form.f.kind} onChange={(v) => set({ kind: v })} /></Field>
              <Field label="Applies to"><Chips items={Object.entries(SCOPE_LABEL).map(([id, label]) => ({ id, label }))} value={form.f.scope} onChange={(v) => set({ scope: v, scope_id: '', scope_name: '' })} /></Field>
              {form.f.scope === 'PRODUCT' ? <ProductFind label="Product" chosen={form.f.scope_name} onPick={(id, name) => set({ scope_id: String(id), scope_name: name })} onClear={() => set({ scope_id: '', scope_name: '' })} /> : null}
              {scopeChoices.length ? <Field label={SCOPE_LABEL[form.f.scope]}><Chips items={scopeChoices} value={form.f.scope_id} onChange={(v) => set({ scope_id: v })} /></Field> : null}
              {form.f.kind !== 'VALUE_DISCOUNT' ? <Input label="Buy at least" hint="Counted in the product's own unit (pieces, kg…)" numeric value={form.f.buy_min_qty} onChange={(v) => set({ buy_min_qty: v })} max={9} /> : null}
              {form.f.kind === 'BUY_X_GET_Y' ? (
                <>
                  <Input label="Free quantity" numeric value={form.f.free_qty} onChange={(v) => set({ free_qty: v })} max={9} />
                  <ProductFind label="Free product" chosen={form.f.free_name} onPick={(id, name) => set({ free_id: String(id), free_name: name })} onClear={() => set({ free_id: '', free_name: '' })} />
                  <Soft>{form.f.scope === 'PRODUCT' ? t('Leave empty to give the same product free.') : t('Choose a free product, as this scheme is not for one product.')}</Soft>
                  <Row label="Repeat for every multiple" hint="Buy 30 with a 10+1 scheme: 3 free; otherwise 1" value={form.f.repeat} onChange={(v) => set({ repeat: v })} />
                  <Input label="Most that can be given free" hint="Blank for no limit" numeric value={form.f.max_free_qty} onChange={(v) => set({ max_free_qty: v })} max={9} />
                </>
              ) : null}
              {form.f.kind === 'QTY_DISCOUNT' ? <Input label="Discount (%)" numeric value={form.f.discount_pct} onChange={(v) => set({ discount_pct: v })} max={6} /> : null}
              {form.f.kind === 'VALUE_DISCOUNT' ? (
                <>
                  <Input label="When the order is at least" numeric value={form.f.min_value} onChange={(v) => set({ min_value: v })} max={10} />
                  <Field label="Discount as"><Chips items={[{ id: 'AMOUNT', label: '₹ off' }, { id: 'PERCENT', label: '% off' }]} value={form.f.value_mode} onChange={(v) => set({ value_mode: v })} /></Field>
                  {form.f.value_mode === 'AMOUNT' ? <Input label="Discount (₹)" numeric value={form.f.discount} onChange={(v) => set({ discount: v })} max={10} /> : <Input label="Discount (%)" numeric value={form.f.discount_pct} onChange={(v) => set({ discount_pct: v })} max={6} />}
                </>
              ) : null}
              <SectionTitle>Who gets it, and when</SectionTitle>
              <Input label="Starts" hint="Like 2026-11-01. Blank: now" value={form.f.starts_on} onChange={(v) => set({ starts_on: v })} max={10} />
              <Input label="Ends" hint="Blank: no end date" value={form.f.ends_on} onChange={(v) => set({ ends_on: v })} max={10} />
              <Field label="Types of shop" hint="None ticked: all"><Multi items={CUSTOMER_TYPE_CHOICES.map((c) => ({ id: c.id, label: t(c.label) }))} values={form.f.customer_types} onToggle={(v) => set({ customer_types: form.f.customer_types.includes(v) ? form.f.customer_types.filter((x) => x !== v) : [...form.f.customer_types, v] })} /></Field>
              <Field label="Funded by"><Chips items={[{ id: 'DISTRIBUTOR', label: 'You' }, { id: 'PRINCIPAL', label: 'A principal' }]} value={form.f.funded_by} onChange={(v) => set({ funded_by: v })} /></Field>
              {form.f.funded_by === 'PRINCIPAL' ? <Field label="Principal" hint="You claim the cost back from them"><Chips items={principalChoices} value={form.f.principal_id} onChange={(v) => set({ principal_id: v })} /></Field> : null}
              <Input label="Priority" hint="When schemes compete, the higher priority wins even if it gives less" value={form.f.priority} onChange={(v) => set({ priority: v.replace(/[^\d-]/g, '') })} max={4} />
              <Row label="Can be combined with other schemes" value={form.f.stackable} onChange={(v) => set({ stackable: v })} />
              <Row label="Switched on" value={form.f.is_active} onChange={(v) => set({ is_active: v })} />
              <Input label="Notes" multiline value={form.f.notes} onChange={(v) => set({ notes: v })} max={300} />
              <Soft>{t('Only named shops and territories are set on the web. A scheme you edit here keeps the ones it has.')}</Soft>
              <Msg a={a} />
              <Button title="Save scheme" busy={a.busy} onPress={() => { void a.run(schemeProblem(form.f), async () => { await api.call(form.id ? `/distributor/schemes/${form.id}` : '/distributor/schemes', { method: form.id ? 'PUT' : 'POST', body: schemeBody(form.f) }); done(); }); }} />
              <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
            </Card>
          ) : null}
        </Panel>
      )}
    </SetupShell>
  );
}
