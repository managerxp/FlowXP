import { useState } from 'react';
import { Text } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Card, Field, Input, Msg, Panel, SetupShell, useAct, useList } from '../lib/formKit.tsx';
import { brandProblem, emptyPrincipal, principalBody, principalForm, principalProblem, principalSub, type Principal, type PrincipalForm } from '../lib/distributorSetup.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, color } from '../lib/ui.tsx';

type Detail = Principal & { brands: { brand_id: number; name: string; products: number }[]; account: { outstanding: number } | null };

/* Principals and brands: the manufacturers you distribute, their agreements, and what you owe them. */
export default function PrincipalsScreen() {
  const me = currentBusiness(useSession());
  const edit = allowed(me, 'principals');
  const [status, setStatus] = useState('ACTIVE');
  const list = useList<Principal[]>(`/distributor/principals?status=${status}&limit=100`);
  const [form, setForm] = useState<{ id?: number; f: PrincipalForm } | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [brand, setBrand] = useState('');
  const a = useAct();
  const pick = (k: keyof PrincipalForm, label: string, extra?: { hint?: string; numeric?: boolean; max?: number; upper?: boolean; multiline?: boolean; placeholder?: string }) =>
    form ? <Input key={k} label={label} value={form.f[k]} onChange={(v) => setForm({ ...form, f: { ...form.f, [k]: v } })} {...extra} /> : null;
  const show = async (id: number) => { a.setError(''); a.setNote(''); try { setOpen(await api.get<Detail>(`/distributor/principals/${id}`)); } catch (e) { a.setError((e as Error).message); } };
  return (
    <SetupShell title="Principals" sub="The manufacturers you distribute, their agreements and brands" ok={allowed(me, 'principals', 'products', 'purchases', 'reports')} denied="You do not have access to principals.">
      <Chips items={[{ id: 'ACTIVE', label: 'Active' }, { id: 'INACTIVE', label: 'Inactive' }, { id: 'ALL', label: 'All' }]} value={status} onChange={setStatus} />
      {list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <Panel>
          {edit ? <Button title="Add a principal" onPress={() => { a.setError(''); setOpen(null); setForm({ f: emptyPrincipal() }); }} /> : null}
          {list.data.length === 0 ? <Soft>{t('Add the manufacturers or brands you distribute.')}</Soft> : null}
          {list.data.map((p) => <Line key={p.principal_id} left={p.name} sub={principalSub(p)} onPress={() => { setForm(null); void show(p.principal_id); }} />)}
          {open ? (
            <Card>
              <SectionTitle>{open.name}</SectionTitle>
              <Soft>{[open.company_name, open.gstin].filter(Boolean).join(' · ')}</Soft>
              {open.account ? <Text style={{ color: color.ink, fontWeight: '600' }}>{t('You owe {value}', { value: rupees(toPaise(open.account.outstanding)) })}</Text> : <Soft>{t('No supplier account is linked yet.')}</Soft>}
              <Field label="Brands" hint="Products are grouped under the brands each principal owns">
                <Soft>{open.brands.length ? open.brands.map((b) => `${b.name} (${t('{n} products', { n: b.products })})`).join(', ') : t('No brands yet.')}</Soft>
              </Field>
              {edit ? (
                <>
                  <Input label="New brand name" value={brand} onChange={setBrand} max={80} />
                  <Button title="Add a brand" kind="quiet" busy={a.busy} onPress={() => { void a.run(brandProblem(brand), async () => { await api.post('/distributor/brands', { name: brand.trim(), principal_id: open.principal_id }); setBrand(''); await show(open.principal_id); list.reload(); }, 'Brand added'); }} />
                  <Button title="Edit" onPress={() => { a.setError(''); setForm({ id: open.principal_id, f: principalForm(open) }); setOpen(null); }} />
                </>
              ) : null}
              <Msg a={a} />
              <Button title="Close" kind="quiet" onPress={() => setOpen(null)} />
            </Card>
          ) : null}
          {form ? (
            <Card>
              {pick('name', 'Principal or brand name', { max: 120 })}
              {pick('company_name', 'Company name', { hint: 'As on their invoices', max: 160 })}
              {pick('contact_person', 'Contact person')}
              {pick('phone', 'Phone')}
              {pick('email', 'Email')}
              {pick('gstin', 'GSTIN', { max: 15, upper: true })}
              {pick('pan', 'PAN', { max: 10, upper: true })}
              {pick('territory_note', 'Territory they appointed you for', { max: 200 })}
              {pick('address', 'Address', { multiline: true })}
              {pick('agreement_start', 'Agreement starts', { hint: 'Like 2026-11-01', max: 10 })}
              {pick('agreement_end', 'Agreement ends', { hint: 'Like 2027-10-31', max: 10 })}
              {pick('margin_pct', 'Margin or commission (%)', { hint: 'What the agreement lets you earn', numeric: true, max: 6 })}
              {pick('payment_terms_days', 'Payment terms (days)', { numeric: true, max: 4 })}
              {pick('credit_limit', 'Credit limit they give you', { numeric: true, max: 10 })}
              {pick('notes', 'Notes', { multiline: true })}
              <Msg a={a} />
              <Button title="Save" busy={a.busy} onPress={() => { void a.run(principalProblem(form.f), async () => { await api.call(form.id ? `/distributor/principals/${form.id}` : '/distributor/principals', { method: form.id ? 'PUT' : 'POST', body: principalBody(form.f) }); setForm(null); list.reload(); }); }} />
              <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
            </Card>
          ) : null}
        </Panel>
      )}
    </SetupShell>
  );
}
