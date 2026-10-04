/*
 * Salon settings: everything a salon can reasonably want different, in one place — nothing here is fixed in
 * code. The business's name, address, GSTIN, logo, invoice prefix and receipt options stay in Settings → Business
 * (one source of truth); this covers what is particular to a salon.
 *
 *   Profile         PAN, registration, franchise / owned outlets
 *   Hours & booking opening days and hours (and per outlet), slot length, notice, buffer, cancellation policy
 *   Tax & payments  GST inclusive or on top, default rates, which payment methods the till offers, commission base
 *   Loyalty         points expiry and the earning rate for each kind of sale (the programme itself is under Loyalty)
 *   Clients & stock what "VIP" or "inactive" mean for this salon, and when stock alerts fire
 *   Messages        reminders and greetings that go out by themselves, and one-off campaigns
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { WEEKDAYS, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, Field, Input, ListState, PageHeader, Select, StatCard, Textarea, useDialog, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, SelectField, Tabs, Toggle, useAction } from './parts.jsx';

const METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', WALLET: 'Wallet' };

/* Shared shell for a form that saves a slice of /salon/settings. */
const useSettings = () => {
  const { data, error, loading, reload, setData } = useLoad('/salon/settings');
  const [busy, run] = useAction();
  const save = async (body, message = 'Saved') => {
    const out = await run(() => api('/salon/settings', { method: 'PUT', body }), message);
    if (out) { setData((d) => ({ ...d, settings: out })); return true; }
    return false;
  };
  return { data, error, loading, reload, save, busy };
};

const SaveBar = ({ busy, dirty = true }) => <div className="flex justify-end border-t border-line pt-4"><Button type="submit" loading={busy} disabled={!dirty}>Save changes</Button></div>;

const DaysPicker = ({ value, onChange, label = 'Open on' }) => (
  <fieldset><legend className="mb-1.5 text-small font-medium text-ink-700">{label}</legend>
    <div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5, 6, 7].map((d) => { const on = value.includes(d); return <button key={d} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())} className={`h-9 w-12 rounded-(--radius-control) border text-small font-medium ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong text-ink-700 hover:bg-surface-2'}`}>{WEEKDAYS[d]}</button>; })}</div>
  </fieldset>
);

/* ── profile ──────────────────────────────────────────────────────────────── */

const Profile = ({ s }) => {
  const { business } = useAuth();
  const [form, setForm] = useState({ pan: s.data.settings.pan || '', registration_type: s.data.settings.registration_type || '', registration_no: s.data.settings.registration_no || '' });
  const [outlets, setOutlets] = useState(s.data.branches);
  const [busy, run] = useAction();
  const submit = async (e) => { e.preventDefault(); await s.save({ pan: form.pan || null, registration_type: form.registration_type || null, registration_no: form.registration_no || null }); };
  const saveOutlet = async (b, patch) => {
    const out = await run(() => api(`/salon/branches/${b.branch_id}/settings`, { method: 'PUT', body: patch }), 'Saved');
    if (out) setOutlets((list) => list.map((x) => (x.branch_id === b.branch_id ? { ...x, ...patch } : x)));
  };
  return (
    <div className="space-y-6">
      <Panel title="Business profile" lead="These print on your tax invoices.">
        <p className="mb-4 text-small text-ink-700"><strong className="font-semibold">{business?.name}</strong> — name, address, GSTIN, logo and invoice numbering are in <Link to="/app/settings/business" className="font-medium text-brand-600 underline">Settings → Business</Link>.</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="pr-pan" label="PAN" hint="Like ABCDE1234F"><Input id="pr-pan" value={form.pan} maxLength={10} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} className="uppercase" /></Field>
            <Field id="pr-rt" label="Registration type" hint="e.g. Shops & Establishments"><Input id="pr-rt" value={form.registration_type} onChange={(e) => setForm((f) => ({ ...f, registration_type: e.target.value }))} /></Field>
            <Field id="pr-rn" label="Registration number"><Input id="pr-rn" value={form.registration_no} onChange={(e) => setForm((f) => ({ ...f, registration_no: e.target.value }))} /></Field>
          </div>
          <SaveBar busy={s.busy} />
        </form>
      </Panel>
      {outlets.length > 1 && (
        <Panel title="Outlets" lead="Mark outlets you run yourself or that a franchisee runs. Add outlets under Outlets.">
          <ul className="divide-y divide-line">
            {outlets.map((b) => (
              <li key={b.branch_id} className="flex flex-wrap items-center gap-3 py-3 text-small">
                <span className="min-w-40 flex-1"><span className="block font-medium text-ink-900">{b.name}{b.is_primary && <span className="ml-2"><Badge tone="brand">Main</Badge></span>}</span><span className="text-caption text-ink-500">{[b.city, b.state].filter(Boolean).join(', ')}</span></span>
                <Select aria-label={`${b.name} ownership`} value={b.ownership} onChange={(e) => saveOutlet(b, { ownership: e.target.value })} className="!w-auto !py-1.5"><option value="OWNED">Owned</option><option value="FRANCHISE">Franchise</option></Select>
                {b.ownership === 'FRANCHISE' && <div className="w-52"><Input aria-label={`${b.name} franchisee`} placeholder="Franchisee name" defaultValue={b.franchisee_name || ''} onBlur={(e) => e.target.value !== (b.franchisee_name || '') && saveOutlet(b, { franchisee_name: e.target.value || null })} className="!py-1.5" /></div>}
              </li>
            ))}
          </ul>
          {busy && <p className="mt-2 text-caption text-ink-500">Saving…</p>}
        </Panel>
      )}
    </div>
  );
};

/* ── hours & booking ──────────────────────────────────────────────────────── */

const Hours = ({ s }) => {
  const c = s.data.settings;
  const [form, setForm] = useState({
    working_days: c.working_days, open_time: c.open_time, close_time: c.close_time, slot_minutes: String(c.slot_minutes), min_advance_minutes: String(c.min_advance_minutes), max_advance_days: String(c.max_advance_days), buffer_minutes: String(c.buffer_minutes),
    cancel_hours: c.cancellation_policy?.min_notice_hours ?? '', cancel_fee: c.cancellation_policy?.fee_pct ?? '', cancel_text: c.cancellation_policy?.text ?? '', noshow_fee: c.no_show_policy?.fee_pct ?? '', noshow_text: c.no_show_policy?.text ?? ''
  });
  const [outlets, setOutlets] = useState(s.data.branches);
  const [, run] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    const pol = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
    await s.save({
      working_days: form.working_days, open_time: form.open_time, close_time: form.close_time, slot_minutes: Number(form.slot_minutes), min_advance_minutes: Number(form.min_advance_minutes), max_advance_days: Number(form.max_advance_days), buffer_minutes: Number(form.buffer_minutes),
      cancellation_policy: pol({ min_notice_hours: form.cancel_hours === '' ? '' : Number(form.cancel_hours), fee_pct: form.cancel_fee === '' ? '' : Number(form.cancel_fee), text: form.cancel_text }),
      no_show_policy: pol({ fee_pct: form.noshow_fee === '' ? '' : Number(form.noshow_fee), text: form.noshow_text })
    });
  };
  const saveOutlet = async (b, patch) => {
    const out = await run(() => api(`/salon/branches/${b.branch_id}/settings`, { method: 'PUT', body: patch }), 'Outlet hours saved');
    if (out) setOutlets((list) => list.map((x) => (x.branch_id === b.branch_id ? { ...x, ...patch } : x)));
  };
  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-6">
        <Panel title="Opening hours" lead="The default for every outlet. Each person can have their own hours under Team.">
          <div className="space-y-4">
            <DaysPicker value={form.working_days} onChange={set('working_days')} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="h-open" label="Opens"><Input id="h-open" type="time" value={form.open_time} onChange={(e) => set('open_time')(e.target.value)} required /></Field>
              <Field id="h-close" label="Closes"><Input id="h-close" type="time" value={form.close_time} onChange={(e) => set('close_time')(e.target.value)} required /></Field>
              <SelectField id="h-slot" label="Booking slots every" value={form.slot_minutes} onChange={set('slot_minutes')}>{s.data.choices.slot_minutes.map((m) => <option key={m} value={m}>{m} minutes</option>)}</SelectField>
            </div>
          </div>
        </Panel>
        <Panel title="Booking rules">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="b-min" label="Shortest notice" suffix="min" min={0} step={5} value={form.min_advance_minutes} onChange={set('min_advance_minutes')} hint="0 lets clients book right now" />
            <NumberField id="b-max" label="Book up to" suffix="days ahead" min={1} step={1} value={form.max_advance_days} onChange={set('max_advance_days')} />
            <NumberField id="b-buf" label="Gap between clients" suffix="min" min={0} step={5} value={form.buffer_minutes} onChange={set('buffer_minutes')} hint="Kept free after every booking" />
          </div>
        </Panel>
        <Panel title="Cancellations and no-shows" lead="Shown to the team when it happens. Nothing is charged automatically.">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="c-hours" label="Free cancellation until" suffix="hours before" min={0} step={1} value={form.cancel_hours} onChange={set('cancel_hours')} />
            <NumberField id="c-fee" label="Late cancellation fee" suffix="%" value={form.cancel_fee} onChange={set('cancel_fee')} />
            <Field id="c-text" label="Cancellation policy wording"><Textarea id="c-text" rows={2} value={form.cancel_text} onChange={(e) => set('cancel_text')(e.target.value)} /></Field>
            <div className="space-y-4"><NumberField id="n-fee" label="No-show fee" suffix="%" value={form.noshow_fee} onChange={set('noshow_fee')} /><Field id="n-text" label="No-show policy wording"><Input id="n-text" value={form.noshow_text} onChange={(e) => set('noshow_text')(e.target.value)} /></Field></div>
          </div>
        </Panel>
        <SaveBar busy={s.busy} />
      </form>

      {outlets.length > 1 && (
        <Panel title="Different hours at an outlet" lead="Leave an outlet as it is to use the default hours above.">
          <ul className="space-y-4">
            {outlets.map((b) => {
              const own = b.open_time != null || b.working_days != null;
              return (
                <li key={b.branch_id} className="rounded-(--radius-card) border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-ink-900">{b.name}</span><Toggle id={`own-${b.branch_id}`} checked={own} onChange={(on) => saveOutlet(b, on ? { open_time: form.open_time, close_time: form.close_time, working_days: form.working_days } : { open_time: null, close_time: null, working_days: null, slot_minutes: null })} label="Its own hours" /></div>
                  {own && (
                    <div className="mt-3 space-y-3">
                      <DaysPicker label="Open on" value={b.working_days || form.working_days} onChange={(v) => saveOutlet(b, { working_days: v })} />
                      <div className="flex flex-wrap items-end gap-3">
                        <Field id={`o-${b.branch_id}`} label="Opens"><Input id={`o-${b.branch_id}`} type="time" defaultValue={b.open_time || form.open_time} onBlur={(e) => e.target.value && saveOutlet(b, { open_time: e.target.value })} /></Field>
                        <Field id={`c-${b.branch_id}`} label="Closes"><Input id={`c-${b.branch_id}`} type="time" defaultValue={b.close_time || form.close_time} onBlur={(e) => e.target.value && saveOutlet(b, { close_time: e.target.value })} /></Field>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
};


/* ── online booking ───────────────────────────────────────────────────────── */

const OnlineBooking = ({ s }) => {
  const c = s.data.settings;
  const toast = useToast();
  const [form, setForm] = useState({ enabled: Boolean(c.online_booking_enabled), slug: c.online_booking_slug || '', notice: c.online_booking_notice || '' });
  const link = form.slug ? `${window.location.origin}/book/${form.slug}` : '';
  const submit = async (e) => {
    e.preventDefault();
    await s.save({ online_booking_enabled: form.enabled, online_booking_slug: form.slug || null, online_booking_notice: form.notice || null }, form.enabled ? 'Online booking is on' : 'Saved');
  };
  return (
    <Panel title="Online booking" lead="A page clients can use to book themselves, without calling. It follows your opening hours, team hours, leave and booking rules.">
      <form onSubmit={submit} className="space-y-4">
        <Toggle id="ob-on" checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="Let clients book online" hint="Needs the Appointments feature on your plan." />
        <Field id="ob-slug" label="Your booking address" hint="Letters, numbers and dashes. This becomes part of the link.">
          <div className="flex items-center gap-2"><span className="text-small text-ink-500">/book/</span><div className="flex-1"><Input id="ob-slug" value={form.slug} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} /></div></div>
        </Field>
        <Field id="ob-notice" label="Message at the top of the page" hint="Optional — parking, what to bring, a festive notice."><Input id="ob-notice" value={form.notice} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, notice: e.target.value }))} /></Field>
        {c.online_booking_enabled && link && (
          <div className="flex flex-wrap items-center gap-2 rounded-(--radius-control) bg-surface-2 px-3.5 py-2.5 text-small">
            <a href={link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-brand-600 underline">{link}</a>
            <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('Link copied'))}>Copy link</Button>
          </div>
        )}
        <p className="text-caption text-ink-500">Online bookings arrive as Booked appointments marked Online. One mobile number can hold up to three upcoming online bookings.</p>
        <SaveBar busy={s.busy} />
      </form>
    </Panel>
  );
};

/* ── tax & payments ───────────────────────────────────────────────────────── */

const TaxPayments = ({ s }) => {
  const c = s.data.settings;
  const { business } = useAuth();
  const [form, setForm] = useState({ tax_inclusive: c.tax_inclusive, default_service_tax_rate: String(c.default_service_tax_rate), default_product_tax_rate: String(c.default_product_tax_rate), default_service_sac: c.default_service_sac || '', payment_methods: c.payment_methods, commission_base: c.commission_base, commission_on_package_use: c.commission_on_package_use });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    await s.save({ ...form, default_service_tax_rate: Number(form.default_service_tax_rate), default_product_tax_rate: Number(form.default_product_tax_rate), default_service_sac: form.default_service_sac || null });
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <Panel title="GST" lead="Whether GST applies at all is set in Settings → Business (GST registered). Rates can be different on each service and product.">
        <div className="space-y-4">
          <div className="rounded-(--radius-control) bg-surface-2 px-3.5 py-2.5 text-small text-ink-700">GST on your bills is currently <strong className="font-semibold">{business?.gst_enabled === false ? 'off' : 'on'}</strong>.</div>
          <SelectField id="t-mode" label="Prices are" value={form.tax_inclusive ? 'in' : 'ex'} onChange={(v) => set('tax_inclusive')(v === 'in')} hint={form.tax_inclusive ? 'The price you type is what the client pays; GST is worked out from inside it.' : 'GST is added on top of the price you type.'}>
            <option value="ex">Before GST — tax added on top</option><option value="in">Including GST — tax is inside the price</option>
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="t-svc" label="New services start at" suffix="%" value={form.default_service_tax_rate} onChange={set('default_service_tax_rate')} />
            <NumberField id="t-prod" label="New products start at" suffix="%" value={form.default_product_tax_rate} onChange={set('default_product_tax_rate')} />
            <Field id="t-sac" label="Default SAC code"><Input id="t-sac" value={form.default_service_sac} onChange={(e) => set('default_service_sac')(e.target.value)} /></Field>
          </div>
        </div>
      </Panel>
      <Panel title="Payment methods at the till" lead="Gift cards and pay-later follow what you sell and who the client is.">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {s.data.choices.payment_methods.map((m) => <Toggle key={m} id={`pm-${m}`} checked={form.payment_methods.includes(m)} onChange={(on) => set('payment_methods')(on ? [...form.payment_methods, m] : form.payment_methods.filter((x) => x !== m))} label={METHOD_LABEL[m] || m} />)}
        </div>
        {form.payment_methods.length === 0 && <p className="mt-2 text-caption text-danger">Keep at least one method on.</p>}
      </Panel>
      <Panel title="Commission rules">
        <div className="space-y-4">
          <SelectField id="cm-base" label="Commission is worked out on" value={form.commission_base} onChange={set('commission_base')} hint="Either way, GST is never part of it.">
            <option value="NET">What the client paid (after discounts)</option><option value="GROSS">The price before discounts</option>
          </SelectField>
          <Toggle id="cm-pkg" checked={form.commission_on_package_use} onChange={set('commission_on_package_use')} label="Pay commission when a service is used from a package or membership" hint="Worked out on the service’s list price, since nothing is charged at the time." />
        </div>
      </Panel>
      <SaveBar busy={s.busy} dirty={form.payment_methods.length > 0} />
    </form>
  );
};

/* ── loyalty ──────────────────────────────────────────────────────────────── */

const KIND_LABEL = { SERVICE: 'Services', PRODUCT: 'Retail products', PACKAGE: 'Packages', MEMBERSHIP: 'Memberships', GIFT_CARD: 'Gift cards' };

const Loyalty = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad('/salon/loyalty');
  const summary = useLoad(data?.enabled !== undefined ? '/salon/loyalty/summary?days=30' : null);
  const [form, setForm] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => { if (data && !form) setForm({ expiry_days: data.expiry_days ?? '', rules: Object.fromEntries(Object.entries(data.rules).map(([k, v]) => [k, { earn_per_100: v.earn_per_100 ?? '', is_enabled: v.is_enabled !== false }])) }); }, [data, form]);
  if (loading && !data) return <ListState loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!form) return null;
  const setRule = (k, patch) => setForm((f) => ({ ...f, rules: { ...f.rules, [k]: { ...f.rules[k], ...patch } } }));
  const submit = async (e) => {
    e.preventDefault();
    const out = await run(() => api('/salon/loyalty', { method: 'PUT', body: { expiry_days: form.expiry_days === '' ? null : Number(form.expiry_days), rules: Object.fromEntries(Object.entries(form.rules).map(([k, r]) => [k, { earn_per_100: r.earn_per_100 === '' ? null : Number(r.earn_per_100), is_enabled: r.is_enabled }])) } }), 'Loyalty rules saved');
    if (out) reload();
  };
  const expireNow = async () => {
    if (!(await dialog.confirm({ title: 'Expire old points now?', body: 'Points older than the expiry period are taken off clients’ balances. Running it twice changes nothing more.', confirmLabel: 'Expire points' }))) return;
    try { const r = await api('/salon/loyalty/expire', { method: 'POST' }); toast.success(`${r.points ?? r.expired ?? 0} points expired`); reload(); summary.reload(); } catch (e) { toast.error(e.message); }
  };
  const p = data.program;
  const s = summary.data;
  return (
    <div className="space-y-6">
      <Panel title="The programme" lead="Points per ₹100, what a point is worth, and the most a bill can be paid with points.">
        {data.enabled && p ? <p className="text-small text-ink-700">Loyalty is <Badge tone="success">on</Badge> — {p.earn_per_100} points per ₹100, each worth ₹{p.point_value}; at least {p.min_redeem_points} points to use, up to {p.max_redeem_pct}% of a bill.</p> : <p className="text-small text-ink-700">Loyalty points are <Badge>off</Badge>.</p>}
        <Button to="/app/loyalty" variant="secondary" size="sm" className="mt-3">{data.enabled ? 'Change the programme and tiers' : 'Switch loyalty on'}</Button>
      </Panel>
      <form onSubmit={submit} className="space-y-6">
        <Panel title="Earning rates by kind of sale" lead="Leave the rate empty to use the programme’s rate. Turn a kind off and it earns nothing. Gift cards never earn.">
          <ul className="divide-y divide-line">
            {Object.keys(form.rules).filter((k) => k !== 'GIFT_CARD').map((k) => (
              <li key={k} className="flex flex-wrap items-center gap-4 py-3">
                <span className="min-w-32 flex-1 text-small font-medium text-ink-900">{KIND_LABEL[k] || k}</span>
                <div className="w-40"><NumberField id={`lr-${k}`} label="Points per ₹100" value={form.rules[k].earn_per_100} onChange={(v) => setRule(k, { earn_per_100: v })} disabled={!form.rules[k].is_enabled} /></div>
                <div className="pt-6"><Toggle id={`le-${k}`} checked={form.rules[k].is_enabled} onChange={(v) => setRule(k, { is_enabled: v })} label="Earns points" /></div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Expiry" lead="How long points last. Empty means they never expire.">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56"><NumberField id="lx-days" label="Points expire after" suffix="days" min={30} step={1} value={form.expiry_days} onChange={(v) => setForm((f) => ({ ...f, expiry_days: v }))} /></div>
            {data.expiry_days && <Button type="button" variant="secondary" onClick={expireNow}>Expire old points now</Button>}
          </div>
          <p className="mt-2 text-caption text-ink-500">Points expire on their own once a day. Clients are warned first if the Loyalty points expiry message is on under Messages.</p>
        </Panel>
        <SaveBar busy={busy} />
      </form>
      {s && (
        <Panel title="Last 30 days">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Issued" value={s.issued} /><StatCard label="Used" value={s.redeemed} /><StatCard label="Expired" value={s.expired} /><StatCard label="Owed to clients" value={`${s.outstanding_points}`} note={`${s.holders} people · worth ₹${Math.round(s.liability).toLocaleString('en-IN')}`} />
          </div>
        </Panel>
      )}
    </div>
  );
};

/* ── clients & stock ──────────────────────────────────────────────────────── */

const Segments = ({ s }) => {
  const c = s.data.settings; const r = c.segment_rules;
  const [form, setForm] = useState({ new_days: String(r.new_days), vip_spend: String(r.vip_spend), vip_visits: String(r.vip_visits), high_spender: String(r.high_spender), frequent_visits_90d: String(r.frequent_visits_90d), inactive_days: r.inactive_days.join(', '), expiry_alert_days: String(c.expiry_alert_days), consumption_alert_factor: String(c.consumption_alert_factor) });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    await s.save({
      segment_rules: { new_days: Number(form.new_days), vip_spend: Number(form.vip_spend), vip_visits: Number(form.vip_visits), high_spender: Number(form.high_spender), frequent_visits_90d: Number(form.frequent_visits_90d), inactive_days: form.inactive_days.split(',').map((x) => Number(x.trim())).filter(Boolean) },
      expiry_alert_days: Number(form.expiry_alert_days), consumption_alert_factor: Number(form.consumption_alert_factor)
    });
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <Panel title="What the client segments mean" lead="Used by the client list, reminders and campaigns.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <NumberField id="sg-new" label="New client for" suffix="days" min={1} step={1} value={form.new_days} onChange={set('new_days')} hint="After their first visit" />
          <NumberField id="sg-vs" label="VIP: spent at least" prefix="₹" value={form.vip_spend} onChange={set('vip_spend')} hint="…or" />
          <NumberField id="sg-vv" label="VIP: visits at least" min={1} step={1} value={form.vip_visits} onChange={set('vip_visits')} />
          <NumberField id="sg-hs" label="High spender: average bill at least" prefix="₹" value={form.high_spender} onChange={set('high_spender')} />
          <NumberField id="sg-fr" label="Frequent: visits in 90 days" min={2} step={1} value={form.frequent_visits_90d} onChange={set('frequent_visits_90d')} />
          <Field id="sg-in" label="Inactive after (days, up to three)" hint="e.g. 30, 60, 90"><Input id="sg-in" value={form.inactive_days} onChange={(e) => set('inactive_days')(e.target.value)} /></Field>
        </div>
      </Panel>
      <Panel title="Stock alerts">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="sa-exp" label="Warn about expiry" suffix="days before" min={1} step={1} value={form.expiry_alert_days} onChange={set('expiry_alert_days')} />
          <NumberField id="sa-con" label="Flag unusual use at" suffix="× the usual" min={1.2} step={0.1} value={form.consumption_alert_factor} onChange={set('consumption_alert_factor')} hint="Compares this week with the previous four" />
        </div>
      </Panel>
      <SaveBar busy={s.busy} />
    </form>
  );
};

/* ── messages ─────────────────────────────────────────────────────────────── */

const SEGMENT_CHOICES = [['NEW', 'New clients'], ['RETURNING', 'Returning clients'], ['VIP', 'VIP clients'], ['HIGH_SPENDER', 'High spenders'], ['FREQUENT', 'Frequent visitors'], ['MEMBER', 'Members'], ['INACTIVE_30', 'Inactive 30+ days'], ['INACTIVE_60', 'Inactive 60+ days'], ['INACTIVE_90', 'Inactive 90+ days']];
const CONFIG_LABEL = { hours_before: ['Hours before', 'h'], days_before: ['Days before', 'd'], days_after: ['Days after the visit', 'd'], days: ['Days without a visit', 'd'], days_overdue: ['Days overdue', 'd'], repeat_days: ['Repeat every', 'd'], offer_text: ['Message', ''] };

const Automation = ({ a, onSaved }) => {
  const [on, setOn] = useState(a.is_enabled);
  const [config, setConfig] = useState(a.config);
  const [busy, run] = useAction();
  const dirty = on !== a.is_enabled || JSON.stringify(config) !== JSON.stringify(a.config);
  const save = async () => { const out = await run(() => api(`/salon/automations/${a.key}`, { method: 'PUT', body: { is_enabled: on, config } }), 'Saved'); if (out) onSaved(); };
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="text-small font-medium text-ink-900">{a.label}{a.internal && <span className="ml-2"><Badge>Team only</Badge></span>}</p><p className="text-caption text-ink-500">{a.description}</p></div>
        <Toggle id={`au-${a.key}`} checked={on} onChange={setOn} label={on ? 'On' : 'Off'} />
      </div>
      {on && Object.keys(a.defaults).length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.keys(a.defaults).map((k) => k === 'offer_text'
            ? <Field key={k} id={`au-${a.key}-${k}`} label={CONFIG_LABEL[k][0]}><Input id={`au-${a.key}-${k}`} value={config[k] ?? ''} maxLength={200} onChange={(e) => setConfig((c) => ({ ...c, [k]: e.target.value }))} /></Field>
            : <NumberField key={k} id={`au-${a.key}-${k}`} label={CONFIG_LABEL[k]?.[0] || k} min={1} step={1} value={config[k] ?? ''} onChange={(v) => setConfig((c) => ({ ...c, [k]: v }))} />)}
        </div>
      )}
      {dirty && <div className="mt-3 flex justify-end"><Button size="sm" loading={busy} onClick={() => { const fixed = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, k === 'offer_text' ? v : Number(v)])); setConfig(fixed); save(); }}>Save</Button></div>}
    </li>
  );
};

const Messages = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { hasFeature } = useAuth();
  const enabled = hasFeature('salon_automation');
  const { data, error, loading, reload } = useLoad('/salon/automations');
  const [segment, setSegment] = useState('INACTIVE_60');
  const [offer, setOffer] = useState('');
  const [audience, setAudience] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setAudience(null);
    api(`/salon/campaigns/audience?segment=${segment}`).then((a) => live && setAudience(a)).catch(() => live && setAudience({ count: 0, sample: [] }));
    return () => { live = false; };
  }, [segment, enabled]);

  if (loading && !data) return <ListState loading />;
  if (error) return <Alert>{error}</Alert>;
  const send = async (e) => {
    e.preventDefault();
    if (!(await dialog.confirm({ title: `Send to ${audience?.count ?? 0} people?`, body: 'This goes out now and cannot be recalled.', confirmLabel: 'Send campaign' }))) return;
    const out = await run(() => api('/salon/campaigns', { method: 'POST', body: { segment, offer } }));
    if (out) { toast.success(`Sent to ${out.recipients} people`); setOffer(''); }
  };
  const runNow = async () => { const out = await run(() => api('/salon/automations/run', { method: 'POST' })); if (out) toast.success('Checked — anything due has been sent'); };
  return (
    <div className="space-y-6">
      {!data.channel_on && <Alert>Messages are switched off, so nothing will be sent yet. Choose a channel under <Link to="/app/messaging" className="underline">Messaging</Link> — WhatsApp, SMS or both, through the provider you use.</Alert>}
      {!enabled && <div className="rounded-(--radius-control) border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-small text-ink-900">Automatic reminders and campaigns are part of a higher plan. You can see what is available below.</div>}
      <Panel title="Automatic messages" lead="They go out by themselves, only to clients who have a mobile number and have not opted out." action={enabled && <Button variant="secondary" size="sm" loading={busy} onClick={runNow}>Check now</Button>}>
        <ul className="divide-y divide-line">{data.automations.map((a) => <Automation key={`${a.key}-${a.is_enabled}`} a={a} onSaved={reload} />)}</ul>
      </Panel>
      {enabled && (
        <Panel title="Send a campaign" lead="One message to a group of clients. One campaign an hour." action={<Megaphone aria-hidden="true" className="h-5 w-5 text-ink-400" />}>
          <form onSubmit={send} className="space-y-4">
            <SelectField id="cp-seg" label="Who" value={segment} onChange={setSegment}>{SEGMENT_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
            <p className="text-small text-ink-700">{audience ? <><strong className="font-semibold">{audience.count}</strong> client{audience.count === 1 ? '' : 's'} would receive it{audience.sample.length > 0 && <span className="text-ink-500"> — {audience.sample.join(', ')}{audience.count > audience.sample.length ? '…' : ''}</span>}.</> : 'Counting…'}</p>
            <Field id="cp-msg" label="Message" hint="Your salon’s name is added. 5–300 characters."><Textarea id="cp-msg" rows={3} value={offer} maxLength={300} onChange={(e) => setOffer(e.target.value)} placeholder="Come in this week and enjoy 15% off any service." required /></Field>
            <div className="flex justify-end"><Button type="submit" loading={busy} disabled={!audience?.count || offer.trim().length < 5}><Send aria-hidden="true" className="h-4 w-4" />Send campaign</Button></div>
          </form>
        </Panel>
      )}
    </div>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'profile', label: 'Profile' }, { key: 'hours', label: 'Hours & booking' }, { key: 'tax', label: 'Tax & payments' },
  { key: 'loyalty', label: 'Loyalty' }, { key: 'clients', label: 'Clients & stock' }, { key: 'messages', label: 'Messages' }
];

const SalonSettings = () => {
  const { hasFeature } = useAuth();
  const s = useSettings();
  const [tab, setTab] = useState('profile');
  const tabs = TABS.filter((t) => t.key !== 'loyalty' || hasFeature('loyalty'));
  return (
    <div>
      <PageHeader title="Salon settings" lead="How your salon works. Every rule here is yours to change." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'loyalty' ? <Loyalty /> : tab === 'messages' ? <Messages /> : (
        <>
          <ListState loading={s.loading && !s.data} error={s.error} />
          {s.data && tab === 'profile' && <Profile s={s} />}
          {s.data && tab === 'hours' && <div className="space-y-6"><Hours s={s} /><OnlineBooking s={s} /></div>}
          {s.data && tab === 'tax' && <TaxPayments s={s} />}
          {s.data && tab === 'clients' && <Segments s={s} />}
        </>
      )}
    </div>
  );
};

export default SalonSettings;
