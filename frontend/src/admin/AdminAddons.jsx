/*
 * The add-on catalog — fully admin-managed (owner's request, 2026-09-29):
 * create a new one, edit any field, scope it to specific business types
 * ("Add-ons for Restaurant" vs "Add-ons for Salon"), or retire one. Every
 * price still seeds at ₹0 (same rule as Plans: a wrong number on a sales
 * call is worse than a blank one). Paying one, from a business's own detail
 * page, sets the same feature override an admin can already set by hand —
 * this page only manages the catalog and what it costs.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Select, Button, Alert, Badge, useToast } from '../components/ui.jsx';
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPES } from './businessTypes.js';

/* A compact set of toggle chips — the same "pick zero or more" job a checkbox list does, in less
   space, matching the pill style already used for business type elsewhere in the admin (Features). */
const BusinessTypePicker = ({ value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {BUSINESS_TYPES.map((t) => {
      const on = value.includes(t);
      return (
        <button
          key={t}
          type="button"
          onClick={() => onChange(on ? value.filter((v) => v !== t) : [...value, t])}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-(--duration-fast) ${
            on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-500 hover:border-ink-400'
          }`}
        >
          {BUSINESS_TYPE_LABEL[t]}
        </button>
      );
    })}
  </div>
);

const emptyDraft = { name: '', description: '', price_monthly: 0, price_yearly: 0, business_types: [] };

const AddonCard = ({ addon, onSave, onDelete }) => {
  const toast = useToast();
  const [form, setForm] = useState({
    name: addon.name, description: addon.description || '', price_monthly: addon.price_monthly, price_yearly: addon.price_yearly,
    business_types: addon.business_types || []
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify({
    name: addon.name, description: addon.description || '', price_monthly: addon.price_monthly, price_yearly: addon.price_yearly,
    business_types: addon.business_types || []
  });

  const save = async () => {
    setSaving(true);
    try {
      await onSave(addon.addon_key, { ...form, price_monthly: Number(form.price_monthly), price_yearly: Number(form.price_yearly) });
      toast.success(`${form.name} saved`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    await onSave(addon.addon_key, { is_active: !addon.is_active });
    toast.success(addon.is_active ? 'Deactivated' : 'Activated');
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete(addon.addon_key);
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-ink-400">{addon.addon_key}</p>
        <Badge tone={addon.is_active ? 'success' : 'neutral'}>{addon.is_active ? 'Active' : 'Inactive'}</Badge>
      </div>

      <Field id={`${addon.addon_key}-name`} label="Name">
        <Input id={`${addon.addon_key}-name`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <div className="mt-3">
        <Field id={`${addon.addon_key}-desc`} label="Description">
          <Input id={`${addon.addon_key}-desc`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field id={`${addon.addon_key}-m`} label="Monthly (₹)">
          <Input id={`${addon.addon_key}-m`} type="number" min="0" step="1" value={form.price_monthly} onChange={(e) => setForm((f) => ({ ...f, price_monthly: e.target.value }))} />
        </Field>
        <Field id={`${addon.addon_key}-y`} label="Yearly (₹)">
          <Input id={`${addon.addon_key}-y`} type="number" min="0" step="1" value={form.price_yearly} onChange={(e) => setForm((f) => ({ ...f, price_yearly: e.target.value }))} />
        </Field>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-sm font-medium text-ink-700">Business types (none picked = every type)</p>
        <BusinessTypePicker value={form.business_types} onChange={(v) => setForm((f) => ({ ...f, business_types: v }))} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="secondary" onClick={toggleActive}>{addon.is_active ? 'Deactivate' : 'Activate'}</Button>
        <Button size="sm" variant="ghost" className="ml-auto text-danger" disabled={deleting} onClick={remove}>{deleting ? 'Removing…' : 'Delete'}</Button>
      </div>
    </Card>
  );
};

const NewAddonForm = ({ onCreate }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      await onCreate({ addon_key: key, ...draft, price_monthly: Number(draft.price_monthly), price_yearly: Number(draft.price_yearly) });
      toast.success(`${draft.name} created`);
      setKey(''); setDraft(emptyDraft); setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ New add-on</Button>;

  return (
    <Card className="sm:col-span-2 lg:col-span-3">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">New add-on</h3>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="new-key" label="Key (e.g. onboarding_help)">
          <Input id="new-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="onboarding_help" />
        </Field>
        <Field id="new-name" label="Name">
          <Input id="new-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Onboarding help" />
        </Field>
        <Field id="new-monthly" label="Monthly (₹)">
          <Input id="new-monthly" type="number" min="0" step="1" value={draft.price_monthly} onChange={(e) => setDraft((d) => ({ ...d, price_monthly: e.target.value }))} />
        </Field>
        <Field id="new-yearly" label="Yearly (₹)">
          <Input id="new-yearly" type="number" min="0" step="1" value={draft.price_yearly} onChange={(e) => setDraft((d) => ({ ...d, price_yearly: e.target.value }))} />
        </Field>
      </div>
      <div className="mt-3">
        <Field id="new-desc" label="Description">
          <Input id="new-desc" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        </Field>
      </div>
      <div className="mt-3">
        <p className="mb-1.5 text-sm font-medium text-ink-700">Business types (none picked = every type)</p>
        <BusinessTypePicker value={draft.business_types} onChange={(v) => setDraft((d) => ({ ...d, business_types: v }))} />
      </div>
      <div className="mt-4 flex gap-2">
        <Button disabled={busy || !key.trim() || !draft.name.trim()} onClick={create}>{busy ? 'Creating…' : 'Create'}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
};

const AdminAddons = () => {
  const [addons, setAddons] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');

  const load = () => adminApi('/addons').then(setAddons).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  const onSave = async (key, body) => {
    const updated = await adminApi(`/addons/${key}`, { method: 'PATCH', body });
    setAddons((rows) => rows.map((a) => (a.addon_key === key ? { ...a, ...updated, price_monthly: updated.price_monthly_paise / 100, price_yearly: updated.price_yearly_paise / 100 } : a)));
  };
  const onCreate = async (body) => { await adminApi('/addons', { method: 'POST', body }); await load(); };
  const onDelete = async (key) => { await adminApi(`/addons/${key}`, { method: 'DELETE' }); await load(); };

  const visible = (addons || []).filter((a) => !filterType || !a.business_types || a.business_types.includes(filterType));

  return (
    <div>
      <PageHeader title="Add-ons" lead="Paid extras a business can buy on top of its plan — priced here, sold as a Cashfree link from its own page." />
      {error && <Alert>{error}</Alert>}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-xs flex-1">
          <Field id="filter-type" label="Show add-ons for">
            <Select id="filter-type" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">Every business type</option>
              {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      {addons && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((addon) => <AddonCard key={addon.addon_key} addon={addon} onSave={onSave} onDelete={onDelete} />)}
          <NewAddonForm onCreate={onCreate} />
        </div>
      )}
    </div>
  );
};

export default AdminAddons;
