/*
 * Business setup.
 *
 * The brief lists ten steps. Ten screens is a wall, and the same brief asks
 * for signup to first invoice in under five minutes — so the ten questions are
 * grouped into four screens by what someone would look up in one go: who you
 * are, where you are, how you are taxed, how invoices are numbered.
 *
 * Every step is skippable and each one saves as it goes, so closing the tab
 * loses nothing and a business that only wants to bill can be through this in
 * under a minute. The last two brief steps — first product, start billing —
 * are the dashboard's checklist rather than a wizard screen, because they are
 * the product rather than settings.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Card, Field, Input, Select } from '../components/ui.jsx';

const BUSINESS_TYPES = [
  ['RESTAURANT', 'Restaurant'], ['CAFE', 'Café'], ['RETAIL', 'Retail'],
  ['SUPERMARKET', 'Supermarket'], ['PHARMACY', 'Pharmacy'], ['SALON', 'Salon'],
  ['SERVICES', 'Services'], ['ELECTRONICS', 'Electronics'], ['CLOTHING', 'Clothing'],
  ['GAMING_CAFE', 'Gaming café'], ['RACING', 'Racing'], ['WHOLESALE', 'Wholesale'],
  ['DISTRIBUTOR', 'Distributor'], ['OTHER', 'Other']
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/* Which fields each screen submits, and what onboarding_step it records on
   the way out. The step number is what lets a returning user resume. */
const STEPS = [
  { title: 'Your business',   lead: 'Confirm what we already have.',              fields: ['name', 'business_type'],                            step: 3 },
  { title: 'Where you trade', lead: 'Appears on your invoices. Skip for now if you like.', fields: ['address', 'city', 'state', 'postal_code', 'phone', 'email'], step: 5 },
  { title: 'Tax and money',   lead: 'Turn GST on only if you are registered.',    fields: ['gst_enabled', 'gstin', 'currency', 'financial_year_start_month'], step: 8 },
  { title: 'Invoices',        lead: 'How your invoice numbers should look.',      fields: ['invoice_prefix'],                                   step: 10 }
];

const Onboarding = () => {
  const { business, refresh } = useAuth();
  const navigate = useNavigate();

  const [index, setIndex] = useState(0);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* Load the real record rather than trusting the summary in context: the
     wizard edits fields (address, GSTIN) that the auth payload does not carry. */
  useEffect(() => {
    api('/businesses/current')
      .then((data) => {
        setForm({
          name: data.name ?? '',
          business_type: data.business_type ?? 'OTHER',
          address: data.address ?? '',
          city: data.city ?? '',
          state: data.state ?? '',
          postal_code: data.postal_code ?? '',
          phone: data.phone ?? '',
          email: data.email ?? '',
          gst_enabled: Boolean(data.gst_enabled),
          gstin: data.gstin ?? '',
          currency: data.currency ?? 'INR',
          financial_year_start_month: data.financial_year_start_month ?? 4,
          invoice_prefix: data.invoice_prefix ?? 'INV'
        });
        // Resume where they stopped rather than restarting from screen one.
        const resumeAt = STEPS.findIndex((s) => s.step > (data.onboarding_step ?? 0));
        setIndex(resumeAt === -1 ? STEPS.length - 1 : resumeAt);
      })
      .catch((caught) => setError(caught.message));
  }, [business?.business_id]);

  if (error && !form) return <p className="text-sm text-danger">{error}</p>;
  if (!form) return <p className="text-sm text-ink-400">Loading…</p>;

  /*
   * An expired business cannot write, so every Save here would 402. Guarding
   * at the top of the wizard rather than at the routes that lead into it —
   * login, the shell's no-business redirect, a bookmarked URL — because a
   * check on one route is a check the other two will drift away from.
   */
  if (!business?.subscription?.can_write) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-ink-900">
            Your 7-day FlowXP trial has ended
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-500">
            Setup is paused until you upgrade. Nothing has been lost — everything you
            created is still here and still readable.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button to="/app/settings/subscription">Upgrade now</Button>
            <Button to="/app" variant="secondary">Back to dashboard</Button>
          </div>
        </Card>
      </div>
    );
  }

  const current = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const set = (field) => (event) =>
    setForm((f) => ({
      ...f,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }));

  const save = async ({ advance }) => {
    setError('');
    setBusy(true);
    try {
      /* Only this screen's fields, plus the step. Sending the whole form each
         time would let a later screen's blank overwrite an earlier answer. */
      const body = { onboarding_step: current.step };
      for (const field of current.fields) body[field] = form[field];
      await api('/businesses/current', { method: 'PATCH', body });

      if (advance && !isLast) {
        setIndex((i) => i + 1);
      } else {
        await refresh();
        navigate('/app', { replace: true });
      }
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <div className="mb-4 flex items-center gap-1.5" aria-hidden="true">
          {STEPS.map((step, i) => (
            <span
              key={step.title}
              className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-500' : 'bg-surface-3'}`}
            />
          ))}
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
          Step {index + 1} of {STEPS.length}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">{current.title}</h1>
        <p className="mt-1.5 text-sm text-ink-500">{current.lead}</p>
      </div>

      <Card className="space-y-4">
        <Alert>{error}</Alert>

        {index === 0 && (
          <>
            <Field id="name" label="Business name">
              <Input id="name" value={form.name} onChange={set('name')} required />
            </Field>
            <Field id="business_type" label="Business type"
                   hint="Decides which screens FlowXP shows you.">
              <Select id="business_type" value={form.business_type} onChange={set('business_type')}>
                {BUSINESS_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {index === 1 && (
          <>
            <Field id="address" label="Address">
              <Input id="address" value={form.address} onChange={set('address')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="city" label="City">
                <Input id="city" value={form.city} onChange={set('city')} />
              </Field>
              <Field id="state" label="State">
                <Input id="state" value={form.state} onChange={set('state')} />
              </Field>
              <Field id="postal_code" label="PIN code">
                <Input id="postal_code" value={form.postal_code} onChange={set('postal_code')} inputMode="numeric" />
              </Field>
              <Field id="phone" label="Phone">
                <Input id="phone" type="tel" value={form.phone} onChange={set('phone')} />
              </Field>
            </div>
            <Field id="email" label="Business email" hint="Where customers reply to your invoices.">
              <Input id="email" type="email" value={form.email} onChange={set('email')} />
            </Field>
          </>
        )}

        {index === 2 && (
          <>
            <label className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3.5">
              <input
                type="checkbox"
                checked={form.gst_enabled}
                onChange={set('gst_enabled')}
                className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]"
              />
              <span>
                <span className="block text-sm font-medium text-ink-900">
                  My business is registered for GST
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  Turns on CGST/SGST/IGST on invoices and the GST reports.
                </span>
              </span>
            </label>

            {form.gst_enabled && (
              <Field id="gstin" label="GSTIN" hint="15 characters, e.g. 36ABCDE1234F1Z5.">
                <Input id="gstin" value={form.gstin} onChange={set('gstin')} maxLength={15}
                       className="uppercase" />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="currency" label="Currency">
                <Select id="currency" value={form.currency} onChange={set('currency')}>
                  <option value="INR">₹ Indian Rupee (INR)</option>
                  <option value="USD">$ US Dollar (USD)</option>
                  <option value="AED">د.إ UAE Dirham (AED)</option>
                  <option value="GBP">£ Pound Sterling (GBP)</option>
                </Select>
              </Field>
              <Field id="fy" label="Financial year starts">
                <Select id="fy" value={form.financial_year_start_month}
                        onChange={set('financial_year_start_month')}>
                  {MONTHS.map((month, i) => (
                    <option key={month} value={i + 1}>{month}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </>
        )}

        {index === 3 && (
          <>
            <Field id="invoice_prefix" label="Invoice prefix"
                   hint={`Invoices will read ${(form.invoice_prefix || 'INV').toUpperCase()}-0001, ${(form.invoice_prefix || 'INV').toUpperCase()}-0002 and so on.`}>
              <Input id="invoice_prefix" value={form.invoice_prefix} onChange={set('invoice_prefix')}
                     maxLength={12} className="uppercase" />
            </Field>
            <p className="text-sm text-ink-500">
              That is everything. Next: add a product and raise your first invoice.
            </p>
          </>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (index === 0 ? navigate('/app') : setIndex((i) => i - 1))}
            disabled={busy}
          >
            {index === 0 ? 'Skip setup' : 'Back'}
          </Button>

          <Button type="button" onClick={() => save({ advance: true })} disabled={busy}>
            {busy ? 'Saving…' : isLast ? 'Finish setup' : 'Save and continue'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Onboarding;
