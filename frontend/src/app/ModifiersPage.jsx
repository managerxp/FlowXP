/*
 * Modifier groups: size/portion variants and add-ons. Which dishes offer a
 * group is set on the dish itself (Products → Edit), because that is where a
 * person is thinking about the dish; this page defines the groups and options.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useToast } from '../components/ui.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Select, SkeletonCards } from '../components/ui.jsx';

const blankOption = () => ({ name: '', price_delta: '0', ingredient_product_id: '', ingredient_qty: '' });

const GroupForm = ({ initial, ingredients, onSaved, onClose }) => {
  const toast = useToast();
  const isEdit = Boolean(initial.group_id);
  const [form, setForm] = useState({
    name: initial.name || '',
    kind: initial.is_variant ? 'variant' : 'addon',
    min_select: initial.min_select ?? 0,
    max_select: initial.max_select ?? '',
    modifiers: initial.modifiers?.length
      ? initial.modifiers.filter((m) => m.is_active !== false).map((m) => ({ ...m, price_delta: String(m.price_delta), ingredient_product_id: m.ingredient_product_id || '', ingredient_qty: m.ingredient_qty ?? '' }))
      : [blankOption(), blankOption()]
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setOption = (index, field, value) => setForm((f) => ({ ...f, modifiers: f.modifiers.map((m, i) => (i === index ? { ...m, [field]: value } : m)) }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    const isVariant = form.kind === 'variant';
    try {
      const body = {
        name: form.name,
        is_variant: isVariant,
        // A variant is "pick exactly one"; an add-on group is whatever range the owner sets.
        min_select: isVariant ? 1 : Number(form.min_select),
        max_select: isVariant ? 1 : (form.max_select === '' ? null : Number(form.max_select)),
        modifiers: form.modifiers.filter((m) => m.name.trim()).map((m) => ({
          modifier_id: m.modifier_id, name: m.name, price_delta: Number(m.price_delta) || 0,
          ingredient_product_id: m.ingredient_product_id ? Number(m.ingredient_product_id) : null,
          ingredient_qty: m.ingredient_qty === '' ? null : Number(m.ingredient_qty)
        }))
      };
      await api(isEdit ? `/modifier-groups/${initial.group_id}` : '/modifier-groups', { method: isEdit ? 'PUT' : 'POST', body });
      toast.success(isEdit ? 'Group saved' : 'Group created');
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? 'Edit group' : 'New modifier group'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="g-name" label="Group name"><Input id="g-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Size, Extras" required autoFocus /></Field>
          <Field id="g-kind" label="Type" hint={form.kind === 'variant' ? 'Customer must pick exactly one (Half / Full).' : 'Optional extras, with a minimum and maximum.'}>
            <Select id="g-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
              <option value="variant">Variant — pick one</option>
              <option value="addon">Add-ons — pick several</option>
            </Select>
          </Field>
        </div>

        {form.kind === 'addon' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="g-min" label="Minimum choices"><Input id="g-min" type="number" min="0" value={form.min_select} onChange={(e) => setForm((f) => ({ ...f, min_select: e.target.value }))} /></Field>
            <Field id="g-max" label="Maximum choices" hint="Leave empty for no limit"><Input id="g-max" type="number" min="1" value={form.max_select} onChange={(e) => setForm((f) => ({ ...f, max_select: e.target.value }))} /></Field>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-ink-700">Options</p>
          <div className="space-y-2">
            {form.modifiers.map((m, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_1fr_6rem_auto]">
                <Input aria-label="Option name" placeholder="Option name" value={m.name} onChange={(e) => setOption(i, 'name', e.target.value)} />
                <Input aria-label="Price change" type="number" step="0.01" placeholder="+₹" value={m.price_delta} onChange={(e) => setOption(i, 'price_delta', e.target.value)} />
                <Select aria-label="Uses ingredient" value={m.ingredient_product_id} onChange={(e) => setOption(i, 'ingredient_product_id', e.target.value)}>
                  <option value="">Uses no ingredient</option>
                  {ingredients.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.unit})</option>)}
                </Select>
                <Input aria-label="Ingredient quantity" type="number" step="0.001" min="0" placeholder="Qty" value={m.ingredient_qty} onChange={(e) => setOption(i, 'ingredient_qty', e.target.value)} disabled={!m.ingredient_product_id} />
                <button type="button" onClick={() => setForm((f) => ({ ...f, modifiers: f.modifiers.filter((_, j) => j !== i) }))} className="text-xs font-semibold text-ink-400 hover:text-danger">Remove</button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setForm((f) => ({ ...f, modifiers: [...f.modifiers, blankOption()] }))}>Add option</Button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save group'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const ModifiersPage = () => {
  const [groups, setGroups] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const [g, i] = await Promise.all([api('/modifier-groups'), api('/products?kind=INGREDIENT')]);
      setGroups(g); setIngredients(i);
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Modifiers" lead="Sizes and add-ons a customer can choose on a dish." action={<Button onClick={() => setEditing({})}>New group</Button>} />
      <ListState loading={!groups && !error} error={error} empty={groups?.length === 0} emptyLabel="No modifier groups yet. Create one for sizes or add-ons, then attach it to a dish from Products." skeleton={<SkeletonCards count={3} />} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups?.map((g) => (
          <Card key={g.group_id}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-ink-900">{g.name}</h3>
              <Badge tone={g.is_variant ? 'brand' : 'neutral'}>{g.is_variant ? 'Variant' : 'Add-ons'}</Badge>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-ink-600">
              {g.modifiers.map((m) => (
                <li key={m.modifier_id} className="flex justify-between"><span>{m.name}</span><span className="text-ink-400">{m.price_delta ? formatCurrency(m.price_delta) : '—'}</span></li>
              ))}
            </ul>
            <button onClick={() => setEditing(g)} className="mt-4 text-xs font-semibold text-brand-600">Edit</button>
          </Card>
        ))}
      </div>

      {editing && <GroupForm initial={editing} ingredients={ingredients} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

export default ModifiersPage;
