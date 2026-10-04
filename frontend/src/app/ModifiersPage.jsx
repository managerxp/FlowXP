/*
 * Options customers choose on a dish: a size or level (pick one) or add-ons
 * (pick any, within limits). The groups on the left, the chosen one on the
 * right (?g=ID): its rule in plain words, its options (price change and any
 * ingredient an option uses up), how it looks at the till, and the dishes
 * that offer it, which can be set here in one go (PUT
 * /modifier-groups/:id/products) as well as dish by dish on Products.
 *
 * A group switched off is ignored by the till and by billing (modules/menu.js
 * loads only active groups); nothing is deleted, old bills keep their snapshot.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Search, Trash2, SlidersHorizontal } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Button, Field, Input, Modal, Select, useToast, EmptyState } from '../components/ui.jsx';

const blankOption = () => ({ key: Math.random(), name: '', price_delta: '0', ingredient_product_id: '', ingredient_qty: '' });
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const priceText = (d) => (d > 0 ? `+${formatCurrency(d)}` : d < 0 ? `−${formatCurrency(-d)}` : 'no charge');

/* The group's rule the way a waiter would say it. */
export const ruleOf = (g) => {
  if (g.is_variant) return 'Pick exactly one';
  const min = g.min_select || 0; const max = g.max_select;
  if (min === 0 && max == null) return 'Optional, pick any';
  if (min === 0) return `Optional, up to ${max}`;
  if (max == null) return `Pick at least ${min}`;
  if (min === max) return `Pick exactly ${min}`;
  return `Pick ${min} to ${max}`;
};

/* ── Add / edit a group ───────────────────────────────────────────────── */

const GroupForm = ({ initial, ingredients, onSaved, onClose }) => {
  const isEdit = Boolean(initial.group_id);
  const [form, setForm] = useState({
    name: initial.name || '',
    kind: initial.group_id ? (initial.is_variant ? 'variant' : 'addon') : 'variant',
    min_select: String(initial.min_select ?? 0),
    max_select: initial.max_select == null ? '' : String(initial.max_select),
    modifiers: initial.modifiers?.length
      ? initial.modifiers.filter((m) => m.is_active !== false).map((m) => ({ ...m, key: m.modifier_id, price_delta: String(m.price_delta), ingredient_product_id: m.ingredient_product_id ? String(m.ingredient_product_id) : '', ingredient_qty: m.ingredient_qty ?? '' }))
      : [blankOption(), blankOption()]
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setOption = (key, patch) => setForm((f) => ({ ...f, modifiers: f.modifiers.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));
  const unitOf = (id) => ingredients.find((p) => String(p.product_id) === String(id))?.unit;
  const isVariant = form.kind === 'variant';
  const preview = { is_variant: isVariant, min_select: isVariant ? 1 : Number(form.min_select) || 0, max_select: isVariant ? 1 : (form.max_select === '' ? null : Number(form.max_select)) };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = {
        name: form.name, is_variant: isVariant, is_active: initial.is_active !== false,
        min_select: preview.min_select, max_select: preview.max_select,
        modifiers: form.modifiers.filter((m) => m.name.trim()).map((m) => ({
          modifier_id: m.modifier_id, name: m.name, price_delta: Number(m.price_delta) || 0,
          ingredient_product_id: m.ingredient_product_id ? Number(m.ingredient_product_id) : null,
          ingredient_qty: m.ingredient_qty === '' ? null : Number(m.ingredient_qty)
        }))
      };
      const saved = await api(isEdit ? `/modifier-groups/${initial.group_id}` : '/modifier-groups', { method: isEdit ? 'PUT' : 'POST', body });
      onSaved(saved, !isEdit);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const legend = 'text-caption font-semibold uppercase tracking-[0.12em] text-ink-500';
  return (
    <Modal title={isEdit ? `Edit ${initial.name}` : 'New option group'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <Field id="g-name" label="Group name" hint="What the waiter asks: Size, Spice level, Extras">
          <Input id="g-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
        </Field>

        <fieldset>
          <legend className={legend}>How customers choose</legend>
          <div role="radiogroup" className="mt-2 grid gap-2 sm:grid-cols-2">
            {[['variant', 'One of these', 'A size or a level: Half / Full, Mild / Hot. Always asked.'], ['addon', 'Any of these', 'Add-ons and extras, within the limits you set.']].map(([v, title, text]) => (
              <button key={v} type="button" role="radio" aria-checked={form.kind === v} onClick={() => setForm((f) => ({ ...f, kind: v }))}
                      className={`rounded-(--radius-card) border p-3.5 text-left ${form.kind === v ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line-strong hover:border-ink-400'}`}>
                <span className="block text-small font-semibold text-ink-900">{title}</span>
                <span className="mt-0.5 block text-caption text-ink-500">{text}</span>
              </button>
            ))}
          </div>
          {!isVariant && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:w-2/3">
              <Field id="g-min" label="At least" hint="0 = optional"><Input id="g-min" type="number" min="0" step="1" value={form.min_select} onChange={(e) => setForm((f) => ({ ...f, min_select: e.target.value }))} /></Field>
              <Field id="g-max" label="At most" hint="Blank = no limit"><Input id="g-max" type="number" min="1" step="1" value={form.max_select} onChange={(e) => setForm((f) => ({ ...f, max_select: e.target.value }))} /></Field>
            </div>
          )}
          <p className="mt-2 text-small font-medium text-brand-700">{ruleOf(preview)}</p>
        </fieldset>

        <fieldset>
          <legend className={legend}>Options</legend>
          <p className="mt-1 text-caption text-ink-500">The price change is added to the dish's price. An option can use up an ingredient (extra cheese uses 20 g of cheese), so stock stays right.</p>
          <div className="mt-3 hidden grid-cols-[minmax(0,1.4fr)_6.5rem_minmax(0,1.3fr)_6rem_2rem] gap-2 text-caption font-medium text-ink-500 sm:grid">
            <span>Option</span><span>Price change ₹</span><span>Uses ingredient</span><span>How much</span><span />
          </div>
          <div className="mt-1.5 space-y-2">
            {form.modifiers.map((m) => (
              <div key={m.key} className="grid grid-cols-2 gap-2 max-sm:rounded-lg max-sm:border max-sm:border-line max-sm:p-2 sm:grid-cols-[minmax(0,1.4fr)_6.5rem_minmax(0,1.3fr)_6rem_2rem]">
                <Input aria-label="Option name" placeholder="e.g. Full plate" value={m.name} onChange={(e) => setOption(m.key, { name: e.target.value })} className="max-sm:col-span-2" />
                <Input aria-label="Price change" type="number" step="0.01" value={m.price_delta} onChange={(e) => setOption(m.key, { price_delta: e.target.value })} />
                <Select aria-label="Uses ingredient" value={m.ingredient_product_id} onChange={(e) => setOption(m.key, { ingredient_product_id: e.target.value, ingredient_qty: e.target.value ? m.ingredient_qty : '' })}>
                  <option value="">Nothing extra</option>
                  {ingredients.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                </Select>
                <Input aria-label="Ingredient quantity" type="number" step="0.001" min="0" placeholder={unitOf(m.ingredient_product_id) || '—'} value={m.ingredient_qty} onChange={(e) => setOption(m.key, { ingredient_qty: e.target.value })} disabled={!m.ingredient_product_id} />
                <button type="button" onClick={() => setForm((f) => ({ ...f, modifiers: f.modifiers.filter((x) => x.key !== m.key) }))} aria-label={`Remove ${m.name || 'option'}`}
                        className="flex h-10 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-2 hover:text-danger max-sm:hidden"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setForm((f) => ({ ...f, modifiers: [...f.modifiers, blankOption()] }))}><Plus aria-hidden="true" className="h-4 w-4" />Add an option</Button>
          {isEdit && <p className="mt-1 text-caption text-ink-500">A removed option is kept on old bills; it just stops being offered.</p>}
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create group'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── Choose the dishes that offer a group ─────────────────────────────── */

const DishPicker = ({ group, onSaved, onClose }) => {
  const [dishes, setDishes] = useState(null);
  const [chosen, setChosen] = useState(() => new Set(group.products.map((p) => p.product_id)));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/products?kind=DISH').then((list) => setDishes(list.filter((p) => !p.is_combo))).catch((e) => setError(e.message)); }, []);

  const q = search.trim().toLowerCase();
  const byCategory = useMemo(() => {
    const map = new Map();
    for (const d of (dishes || []).filter((x) => !q || x.name.toLowerCase().includes(q))) {
      const k = d.category_name || 'No category';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(d);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [dishes, q]);
  const toggle = (ids, on) => setChosen((s) => { const n = new Set(s); for (const id of ids) (on ? n.add(id) : n.delete(id)); return n; });

  const save = async () => {
    setBusy(true); setError('');
    try { onSaved(await api(`/modifier-groups/${group.group_id}/products`, { method: 'PUT', body: { product_ids: [...chosen] } })); }
    catch (caught) { setError(caught.message); setBusy(false); }
  };

  return (
    <Modal title={`Which dishes offer ${group.name}?`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <label className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <span className="sr-only">Search dishes</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dishes" className="!pl-9" autoFocus />
        </label>
        {!dishes && !error && <div className="h-48 animate-pulse rounded-lg bg-surface-3" />}
        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
          {byCategory.map(([category, list]) => {
            const ids = list.map((d) => d.product_id);
            const all = ids.every((id) => chosen.has(id));
            return (
              <section key={category} aria-label={category}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{category}</h3>
                  <button type="button" onClick={() => toggle(ids, !all)} className="text-caption font-medium text-brand-700">{all ? 'None' : 'All'}</button>
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {list.map((d) => {
                    const on = chosen.has(d.product_id);
                    return (
                      <li key={d.product_id}>
                        <button type="button" onClick={() => toggle([d.product_id], !on)} aria-pressed={on}
                                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-small ${on ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-ink-400'}`}>
                          <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong'}`}>{on && <Check className="h-3 w-3" />}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-900">{d.name}</span>
                          <span className="tabular shrink-0 text-caption text-ink-500">{formatCurrency(d.selling_price)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {dishes && byCategory.length === 0 && <p className="text-center text-small text-ink-500">{q ? 'No dishes match.' : 'No dishes on the menu yet.'}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <p className="tabular text-small text-ink-700">{chosen.size} dish{chosen.size === 1 ? '' : 'es'} chosen</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy || !dishes}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ── One group ────────────────────────────────────────────────────────── */

/* Roughly what the waiter sees in the picker at the till. */
const TillPreview = ({ g }) => (
  <div className="rounded-(--radius-card) border border-line bg-surface-2 p-4">
    <p className="text-small font-semibold text-ink-900">{g.name} <span className="font-normal text-ink-500">· {g.is_variant || g.min_select > 0 ? 'Required' : 'Optional'}{!g.is_variant && g.max_select ? ` · up to ${g.max_select}` : ''}</span></p>
    <div className="mt-2 space-y-1.5">
      {g.modifiers.filter((m) => m.is_active !== false).map((m, i) => (
        <div key={m.modifier_id} className={`flex items-center justify-between rounded-lg border bg-surface px-3 py-2 text-small ${i === 0 && g.is_variant ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line'}`}>
          <span className="flex items-center gap-2 text-ink-900"><span aria-hidden="true" className={`h-3.5 w-3.5 border ${g.is_variant ? 'rounded-full' : 'rounded'} ${i === 0 && g.is_variant ? 'border-[5px] border-brand-500' : 'border-line-strong'}`} />{m.name}</span>
          {m.price_delta !== 0 && <span className="tabular text-caption text-ink-500">{priceText(m.price_delta)}</span>}
        </div>
      ))}
    </div>
  </div>
);

const GroupPanel = ({ group: g, ingredients, onEdit, onPick, onToggle, onBack }) => {
  const nameOf = (id) => ingredients.find((p) => p.product_id === id);
  const options = g.modifiers.filter((m) => m.is_active !== false);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4 sm:p-6">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />All option groups</button>
        <p className="text-caption font-medium text-ink-500">{g.is_variant ? 'One of these' : 'Add-ons'}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h2 className="text-title font-semibold text-ink-900">{g.name}</h2>
          {!g.is_active && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-caption font-semibold text-ink-500">Off</span>}
        </div>
        <p className="mt-0.5 text-small font-medium text-brand-700">{ruleOf(g)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="secondary" onClick={onPick}>Choose dishes</Button>
          <Button size="sm" variant="ghost" onClick={onToggle}>{g.is_active ? 'Turn off' : 'Turn on'}</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {!g.is_active && <p className="rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-700">Off: the till does not offer it and bills do not ask for it. Turn it on to offer it again on the same dishes.</p>}

        <section aria-label="Options">
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Options · {options.length}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
            {options.map((m) => {
              const ing = m.ingredient_product_id && nameOf(m.ingredient_product_id);
              return (
                <li key={m.modifier_id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-small">
                  <span className="min-w-0">
                    <span className="block text-ink-900">{m.name}</span>
                    {m.ingredient_product_id && <span className="tabular block text-caption text-ink-500">uses {qty(m.ingredient_qty)} {ing?.unit || ''} {ing?.name || 'of an ingredient'}</span>}
                  </span>
                  <span className={`tabular shrink-0 ${m.price_delta ? 'font-medium text-ink-900' : 'text-ink-500'}`}>{priceText(m.price_delta)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="At the till">
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">At the till</h3>
          <TillPreview g={g} />
        </section>

        <section aria-label="Used on">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Offered on · {g.products.length}</h3>
            <button type="button" onClick={onPick} className="text-caption font-medium text-brand-700">Change</button>
          </div>
          {g.products.length === 0 ? (
            <button type="button" onClick={onPick} className="w-full rounded-(--radius-card) border border-dashed border-line-strong p-4 text-left text-small text-ink-500 hover:border-ink-400">
              Not on any dish yet, so no one is asked. <span className="font-medium text-brand-700">Choose dishes</span>
            </button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {g.products.map((p) => <Link key={p.product_id} to={`/app/products?p=${p.product_id}`} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-small text-ink-700 hover:border-ink-400">{p.name}</Link>)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const ModifiersPage = () => {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('g') ? Number(params.get('g')) : null;
  const [groups, setGroups] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // {} = new, a group = edit
  const [picking, setPicking] = useState(false);

  const load = async () => {
    try {
      const [g, i] = await Promise.all([api('/modifier-groups?all=true'), api('/products?kind=INGREDIENT')]);
      setGroups(g); setIngredients(i); setError('');
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, []);
  const open = (id) => setParams(id ? { g: String(id) } : {});
  const selected = (groups || []).find((g) => g.group_id === selectedId);

  const toggle = async (g) => {
    try {
      await api(`/modifier-groups/${g.group_id}`, { method: 'PUT', body: { name: g.name, is_variant: g.is_variant, min_select: g.min_select, max_select: g.max_select, is_active: !g.is_active, modifiers: g.modifiers.filter((m) => m.is_active !== false) } });
      toast.success(g.is_active ? `${g.name} turned off` : `${g.name} is on again`);
      load();
    } catch (caught) { setError(caught.message); }
  };

  const active = (groups || []).filter((g) => g.is_active);
  const unused = active.filter((g) => g.products.length === 0).length;

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 xl:h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_440px]">
      <section aria-label="Option groups" className={`min-w-0 p-4 sm:p-6 lg:p-8 xl:block xl:overflow-y-auto ${selectedId ? 'hidden' : 'block'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">Options & add-ons</h1>
            <p className="tabular mt-1 text-small text-ink-500">
              {groups ? <>Sizes, levels and add-ons customers choose on a dish · {active.length} in use{unused > 0 && <> · <span className="font-medium text-warning">{unused} not on any dish</span></>}</> : 'Sizes, levels and add-ons customers choose on a dish.'}
            </p>
          </div>
          <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />New group</Button>
        </div>

        <div className="mt-5">
          <Alert>{error}</Alert>
          {!groups && !error && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {groups?.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">No option groups yet</p>
              <p className="mt-1 text-small text-ink-500">Make one for a size (Half / Full), a level (Mild / Hot) or extras (Cheese, Egg), then choose the dishes that offer it.</p>
              <Button className="mt-4" onClick={() => setEditing({})}>Make the first group</Button>
            </div>
          )}
          {groups?.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {groups.map((g) => {
                const options = g.modifiers.filter((m) => m.is_active !== false);
                return (
                  <li key={g.group_id}>
                    <button type="button" onClick={() => open(g.group_id)} aria-current={g.group_id === selectedId ? 'true' : undefined}
                            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) ${g.group_id === selectedId ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className={`text-small font-semibold ${g.is_active ? 'text-ink-900' : 'text-ink-500'}`}>{g.name}</span>
                          <span className="text-caption text-ink-500">{ruleOf(g)}</span>
                          {!g.is_active && <span className="rounded bg-surface-2 px-1.5 text-caption font-semibold text-ink-500">Off</span>}
                        </span>
                        <span className="block truncate text-caption text-ink-500">{options.map((m) => m.name).join(', ')}</span>
                      </span>
                      <span className={`tabular shrink-0 text-caption ${g.is_active && g.products.length === 0 ? 'font-medium text-warning' : 'text-ink-500'}`}>{g.products.length ? `on ${g.products.length} dish${g.products.length === 1 ? '' : 'es'}` : 'on no dish'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Selected group" className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selected ? (
          <GroupPanel key={selected.group_id} group={selected} ingredients={ingredients} onEdit={() => setEditing(selected)} onPick={() => setPicking(true)} onToggle={() => toggle(selected)} onBack={() => open(null)} />
        ) : (
          <EmptyState compact icon={SlidersHorizontal} className="h-full justify-center" title="Pick a group" body="See its options, how it looks at the till, and the dishes that offer it." />
        )}
      </section>

      {editing && (
        <GroupForm initial={editing} ingredients={ingredients} onClose={() => setEditing(null)}
                   onSaved={(g, isNew) => { setEditing(null); toast.success(isNew ? `${g.name} created. Now choose its dishes.` : 'Saved'); load(); if (isNew) { open(g.group_id); setPicking(true); } }} />
      )}
      {picking && selected && (
        <DishPicker group={selected} onClose={() => setPicking(false)} onSaved={(g) => { setPicking(false); toast.success(`${g.name} is on ${g.products.length} dish${g.products.length === 1 ? '' : 'es'}`); load(); }} />
      )}
    </div>
  );
};

export default ModifiersPage;
