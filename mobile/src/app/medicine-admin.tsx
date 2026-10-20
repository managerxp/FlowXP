import { useEffect, useState } from 'react';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, Row, SetupShell, useAct, useList } from '../lib/formKit.tsx';
import { TYPE_CHOICES, canMedicineAdmin, categoryProblem, emptyItem, itemBody, itemForm, itemProblem, itemSub, withExpiry, type Item, type ItemForm } from '../lib/medicineAdmin.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, s } from '../lib/ui.tsx';
import { TextInput } from 'react-native';


/* Medicines and items: the product master of a pharmacy, with prices and the rules each item follows. */
export default function MedicineAdminScreen() {
  const me = currentBusiness(useSession());
  const ok = canMedicineAdmin((p) => allowed(me, p));
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [show, setShow] = useState('ACTIVE');
  useEffect(() => { const timer = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(timer); }, [text]);
  const path = `/pharmacy/products?limit=100&status=${show === 'LOW' ? 'ACTIVE' : show}${q ? `&q=${encodeURIComponent(q)}` : ''}${type ? `&type=${type}` : ''}`;
  const list = useList<Item[]>(path);
  const cats = useList<{ category_id: number; name: string }[]>('/pharmacy/categories');
  const [form, setForm] = useState<{ id?: number; f: ItemForm } | null>(null);
  const [newCat, setNewCat] = useState('');
  const a = useAct();
  const set = (patch: Partial<ItemForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  const rows = (list.data ?? []).filter((p) => show !== 'LOW' || p.low);
  const catChoices = [{ id: '', label: t('None') }, ...(cats.data ?? []).map((c) => ({ id: String(c.category_id), label: c.name }))];
  return (
    <SetupShell title="Medicines and items" sub="Add, change and price what you stock" ok={ok} denied="You do not have access to medicines and items.">
      <TextInput style={[s.input, { marginHorizontal: 16 }]} value={text} onChangeText={setText} placeholder={t('Name or composition')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Name or composition')} />
      <Chips items={[{ id: '', label: 'All types' }, ...TYPE_CHOICES]} value={type} onChange={setType} />
      <Chips items={[{ id: 'ACTIVE', label: 'Active' }, { id: 'LOW', label: 'Low stock' }, { id: 'ARCHIVED', label: 'Archived' }]} value={show} onChange={setShow} />
      {list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <Panel>
          <Button title="Add an item" onPress={() => { a.setError(''); setForm({ f: emptyItem() }); }} />
          {rows.length === 0 ? <Soft>{q ? t('Nothing matches that search.') : t('Add what you stock and sell.')}</Soft> : null}
          {rows.map((p) => <Line key={p.product_id} left={p.name} sub={itemSub(p)} onPress={() => { a.setError(''); setForm({ id: p.product_id, f: itemForm(p) }); }} />)}
          {form ? (
            <Card>
              <SectionTitle>Basics</SectionTitle>
              <Input label="Name" value={form.f.name} onChange={(v) => set({ name: v })} max={160} />
              <Input label="Item code" value={form.f.sku} onChange={(v) => set({ sku: v })} max={64} />
              <Input label="Barcode" value={form.f.barcode} onChange={(v) => set({ barcode: v })} max={64} />
              <Input label="Sold by" value={form.f.unit} onChange={(v) => set({ unit: v })} max={24} placeholder="Strip, bottle, piece" />
              <Field label="Category"><Chips items={catChoices} value={form.f.category_id} onChange={(v) => set({ category_id: v })} /></Field>
              <Input label="New category" value={newCat} onChange={setNewCat} max={120} />
              <Button title="Add a category" kind="quiet" busy={a.busy} onPress={() => { void a.run(categoryProblem(newCat), async () => { const c = await api.post<{ category_id: number }>('/pharmacy/categories', { name: newCat.trim() }); setNewCat(''); cats.reload(); set({ category_id: String(c.category_id) }); }, 'Category added'); }} />
              <Input label="HSN code" value={form.f.hsn_sac} onChange={(v) => set({ hsn_sac: v })} max={16} />
              <Input label="GST (%)" numeric value={form.f.tax_rate} onChange={(v) => set({ tax_rate: v })} max={5} />
              <Input label="Description" multiline value={form.f.description} onChange={(v) => set({ description: v })} max={1000} />
              <SectionTitle>Medicine details</SectionTitle>
              <Field label="Type"><Chips items={TYPE_CHOICES} value={form.f.product_type} onChange={(v) => set({ product_type: v })} /></Field>
              <Input label="Maker" value={form.f.manufacturer} onChange={(v) => set({ manufacturer: v })} max={120} />
              <Input label="Strength" value={form.f.strength} onChange={(v) => set({ strength: v })} max={40} placeholder="500mg, 10ml" />
              <Input label="Form" value={form.f.dosage_form} onChange={(v) => set({ dosage_form: v })} max={40} placeholder="Tablet, syrup, injection" />
              <Input label="Schedule" value={form.f.schedule_class} onChange={(v) => set({ schedule_class: v.toUpperCase() })} max={8} placeholder="H, H1, X" />
              <Input label="Salt composition" value={form.f.salt_composition} onChange={(v) => set({ salt_composition: v })} max={300} />
              <SectionTitle>Rules</SectionTitle>
              <Row label="Tracked by batch" hint="Stock is received and sold against batch numbers" value={form.f.batch_tracking} onChange={(v) => set({ batch_tracking: v })} />
              <Row label="Tracked by expiry" hint="Every batch needs an expiry date" value={form.f.expiry_tracking} onChange={(v) => setForm({ ...form, f: withExpiry(form.f, v) })} />
              <Row label="Soonest expiry goes first" hint="Selling picks the soonest-expiring batch automatically" value={form.f.fefo_required} onChange={(v) => set({ fefo_required: v })} />
              <Row label="Tracked by serial number" hint="One serial number per unit (devices, equipment)" value={form.f.serial_tracking} onChange={(v) => set({ serial_tracking: v })} />
              <Row label="Prescription required" value={form.f.prescription_required} onChange={(v) => set({ prescription_required: v })} />
              <Row label="Carries a warranty" value={form.f.warranty_applicable} onChange={(v) => set({ warranty_applicable: v })} />
              {form.f.warranty_applicable ? <Input label="Warranty (months)" numeric value={form.f.warranty_months} onChange={(v) => set({ warranty_months: v })} max={3} /> : null}
              <Row label="Service history tracked" value={form.f.service_trackable} onChange={(v) => set({ service_trackable: v })} />
              <SectionTitle>Price and stock</SectionTitle>
              <Input label="MRP" numeric value={form.f.mrp} onChange={(v) => set({ mrp: v })} max={9} />
              <Input label="Selling price" numeric value={form.f.selling_price} onChange={(v) => set({ selling_price: v })} max={9} />
              <Input label="Buying price" numeric value={form.f.purchase_price} onChange={(v) => set({ purchase_price: v })} max={9} />
              <Input label="Reorder level" numeric value={form.f.reorder_level} onChange={(v) => set({ reorder_level: v })} max={9} />
              <Row label="Keep stock count for this item" value={form.f.track_inventory} onChange={(v) => set({ track_inventory: v })} />
              {form.id ? <Row label="Active" hint="Archived items are hidden from the till" value={form.f.status === 'ACTIVE'} onChange={(v) => set({ status: v ? 'ACTIVE' : 'ARCHIVED' })} /> : null}
              <Msg a={a} />
              <Button title="Save" busy={a.busy} onPress={() => { void a.run(itemProblem(form.f), async () => { await api.call(form.id ? `/pharmacy/products/${form.id}` : '/pharmacy/products', { method: form.id ? 'PUT' : 'POST', body: itemBody(form.f) }); setForm(null); list.reload(); }, form.id ? 'Saved' : 'Added'); }} />
              <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
            </Card>
          ) : null}
        </Panel>
      )}
    </SetupShell>
  );
}
