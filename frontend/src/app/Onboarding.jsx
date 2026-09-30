/*
 * Business setup.
 *
 * The brief lists ten steps. Ten screens is a wall, and the same brief asks
 * for signup to first invoice in under five minutes — so the ten questions are
 * grouped into three screens by what someone would look up in one go: where
 * you are (with a map to check it), how you look (logo, for receipts and the
 * QR menu), how you are taxed and numbered. Business name and type are NOT
 * asked here — signup already asked for both, and asking again read as the
 * form not having listened the first time; they can still be fixed later in
 * Business Settings.
 *
 * Every step is skippable and each one saves as it goes, so closing the tab
 * loses nothing and a business that only wants to bill can be through this in
 * under a minute. The last two brief steps — first product, start billing —
 * are the dashboard's checklist rather than a wizard screen, because they are
 * the product rather than settings.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed, Loader2, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { COUNTRIES, regionsFor, subdivisionLabel } from '../lib/states.js';
import PincodeHint from '../components/PincodeHint.jsx';
import { Alert, Button, Card, Field, Input, Select, useToast } from '../components/ui.jsx';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/* Which fields each screen submits, and what onboarding_step it records on
   the way out. The step number is what lets a returning user resume. */
const STEPS = [
  { title: 'Where you trade', lead: 'Appears on your invoices and your QR menu. Skip for now if you like.', fields: ['address', 'city', 'state', 'postal_code', 'country', 'phone', 'email'], step: 5 },
  { title: 'How you look',    lead: 'Your logo, wherever your business shows itself.',           fields: [],                                                    step: 6 },
  { title: 'Tax and money',   lead: 'Turn GST on only if you are registered.',    fields: ['gst_enabled', 'gstin', 'currency', 'financial_year_start_month'], step: 8 },
  { title: 'Invoices',        lead: 'How your invoice numbers should look.',      fields: ['invoice_prefix'],                                   step: 10 }
];

/* A live preview built from whatever address has been typed so far — no API key needed
   (Google's plain map embed takes a search query, not a Places/Maps JS key), so this
   works the moment someone starts typing rather than needing an account set up first.
   `coords` (from "Use current location") centers the map even before any address text
   has been filled in — e.g. when the location lookup below couldn't turn it into text. */
const MapPreview = ({ address, city, state, country, coords }) => {
  const query = [address, city, state, country].filter(Boolean).join(', ').trim();
  const src = query
    ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
    : coords
      ? `https://www.google.com/maps?q=${coords.lat},${coords.lon}&output=embed`
      : null;
  if (!src) return (
    <p className="flex h-40 items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-2 text-center text-caption text-ink-500">
      Start typing an address, or use your current location, to see it on the map
    </p>
  );
  return (
    <iframe
      title="Your location on the map"
      className="h-40 w-full rounded-lg border border-line"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      src={src}
    />
  );
};

/*
 * BigDataCloud's free reverse-geocode endpoint — no key, no signup, made for
 * calling straight from browser JS (same "no API key needed" rule as the map
 * embed above). Locality-level accuracy, not house-level, so it fills a
 * reasonable starting point and the owner still reviews/edits it, the same
 * "suggestion, not silent overwrite" trust as PincodeHint — except here the
 * click itself is the person asking for this, so filling in the fields
 * directly (rather than a tap-to-apply chip) matches what they asked for.
 */
const reverseGeocode = async (lat, lon) => {
  const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
  if (!res.ok) throw new Error('lookup failed');
  return res.json();
};

const LocateButton = ({ onFound, onCoords }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const locate = () => {
    setError('');
    if (!navigator.geolocation) { setError('Your browser does not support location lookup — enter the address by hand.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        onCoords({ lat: latitude, lon: longitude });
        try {
          const place = await reverseGeocode(latitude, longitude);
          onFound({
            address: place.locality || '',
            city: place.city || place.locality || '',
            state: place.principalSubdivision || '',
            postal_code: place.postcode || '',
            country: place.countryName || 'India'
          });
        } catch {
          setError('Found your location, but could not look up the address — see it on the map below and enter the rest by hand.');
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        setError(err.code === err.PERMISSION_DENIED
          ? 'Location access was blocked. Allow it in your browser and try again, or enter the address by hand.'
          : 'Could not get your location — enter the address by hand.');
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  };

  return (
    <div>
      <button type="button" onClick={locate} disabled={busy}
              className="flex items-center gap-1.5 text-caption font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60">
        {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed aria-hidden="true" className="h-3.5 w-3.5" />}
        {busy ? 'Finding you…' : 'Use current location'}
      </button>
      {error && <p className="mt-1 text-caption text-warning">{error}</p>}
    </div>
  );
};

/* The picture printed at the top of receipts and shown at the top of the QR menu — the exact same
   setting as Business Settings' Logo control, saved immediately on choosing a file (its own endpoint,
   not part of this wizard's Save and continue) so there is nothing to lose by skipping ahead. */
const LogoStep = ({ logoUrl, onChange }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('logo', file);
      const r = await api('/businesses/current/logo', { method: 'POST', body });
      onChange(r.logo_url); toast.success('Logo saved');
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); e.target.value = ''; }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await api('/businesses/current/logo', { method: 'DELETE' }); onChange(null); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <Alert>{error}</Alert>
      <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-2 p-4">
        {logoUrl ? <img src={logoUrl} alt="Your logo" className="h-16 max-w-[9rem] rounded border border-line bg-white object-contain p-1" />
          : <span className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-line-strong text-caption text-ink-400">No logo</span>}
        <div>
          <label className="inline-block cursor-pointer rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-small font-semibold text-brand-600 hover:border-brand-500">
            {busy ? 'Working…' : logoUrl ? 'Replace' : 'Upload a logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={upload} disabled={busy} />
          </label>
          {logoUrl && <button type="button" className="ml-3 text-small font-semibold text-danger" onClick={remove} disabled={busy}>Remove</button>}
        </div>
      </div>
      <p className="mt-2 text-caption text-ink-500">PNG, JPEG or WebP up to 2 MB. Shows on the receipt and at the top of the menu customers see when they scan a table's QR code. Nothing here yet? Skip it — you can add one later in Business Settings.</p>
    </div>
  );
};

/* Only the fields Flow AI is ever asked to fill in (see modules/ai/onboarding.js's tool schema) —
   sent as context on every turn so it knows what's already been said and doesn't ask again. */
const ONBOARDING_AI_FIELDS = ['address', 'city', 'state', 'postal_code', 'country', 'gst_enabled', 'gstin', 'currency', 'financial_year_start_month', 'invoice_prefix'];

/*
 * A chat next to the wizard: type naturally and Flow AI drafts the form's own
 * fields — it never saves anything itself, same trust boundary as "Use
 * current location" above; the owner still reviews and hits Save. Available
 * across every step (not just the address one) since it can fill tax and
 * invoice fields too, just not the logo (a file, so it says so instead).
 * History lives only here, for the length of this page — nothing is stored
 * server-side (see modules/ai/onboarding.js's own comment on why).
 */
const OnboardingAssistant = ({ form, onFields }) => {
  const [status, setStatus] = useState(null); // null while loading; false once known unavailable
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    api('/ai/status').then((s) => setStatus(s.configured && s.enabled ? s : false)).catch(() => setStatus(false));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const send = async (e) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText(''); setError('');
    setMessages((ms) => [...ms, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const currentForm = Object.fromEntries(ONBOARDING_AI_FIELDS.map((k) => [k, form[k]]));
      const result = await api('/ai/onboarding-chat', { method: 'POST', body: { message, history: messages, current_form: currentForm } });
      setMessages((ms) => [...ms, { role: 'assistant', content: result.reply }]);
      if (result.fields && Object.keys(result.fields).length) onFields(result.fields);
    } catch (caught) {
      setMessages((ms) => ms.slice(0, -1)); // drop the optimistic user bubble — nothing came back for it, so let them retry
      setText(message);
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  if (status === null || status === false) return null; // quietly absent rather than a dead chat box — the fields below always work by hand

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-ink-900">
        <span className="flex items-center gap-1.5"><Sparkles aria-hidden="true" className="h-4 w-4 text-brand-600" />Let Flow AI fill this in for you</span>
        <span className="text-xs font-normal text-ink-400">{open ? 'Hide' : 'Try it'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-xs text-ink-500">
                Tell it about your address, GST or invoice numbering — e.g. "I'm on MG Road, Bengaluru, GST registered 29ABCDE1234F1Z5".
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${m.role === 'user' ? 'bg-brand-500 text-white' : 'border border-line bg-surface text-ink-800'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && <div className="flex justify-start"><div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink-500">Thinking…</div></div>}
            <div ref={endRef} />
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <form onSubmit={send} className="mt-2 flex gap-2">
            <input
              value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
              placeholder="Type here…" aria-label="Message Flow AI"
              className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
            />
            <Button type="submit" size="sm" disabled={busy || !text.trim()}>Send</Button>
          </form>
        </div>
      )}
    </div>
  );
};

const Onboarding = () => {
  const { business, refresh } = useAuth();
  const navigate = useNavigate();

  const [index, setIndex] = useState(0);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [coords, setCoords] = useState(null); // raw lat/lon from "Use current location", for the map when reverse geocoding fails

  /* Load the real record rather than trusting the summary in context: the
     wizard edits fields (address, GSTIN) that the auth payload does not carry. */
  useEffect(() => {
    api('/businesses/current')
      .then((data) => {
        setForm({
          address: data.address ?? '',
          city: data.city ?? '',
          state: data.state ?? '',
          postal_code: data.postal_code ?? '',
          country: data.country || 'India',
          phone: data.phone ?? '',
          email: data.email ?? '',
          logo_url: data.receipt_settings?.logo_url ?? null,
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
  const regions = regionsFor(form.country);
  const set = (field) => (event) =>
    setForm((f) => ({
      ...f,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }));
  // A state picked for one country rarely means anything for another — clear it rather than leave a stale value.
  const setCountry = (event) => setForm((f) => ({ ...f, country: event.target.value, state: '' }));

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
        <h1 className="mt-2 text-h3 font-semibold text-ink-900">{current.title}</h1>
        <p className="mt-1.5 text-sm text-ink-500">{current.lead}</p>
      </div>

      {/* Not on the Logo step — nothing there for Flow AI to fill in, only an upload button. */}
      {index !== 1 && (
        <OnboardingAssistant
          form={form}
          onFields={(fields) => setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v != null)) }))}
        />
      )}

      <Card className="space-y-4">
        <Alert>{error}</Alert>

        {index === 0 && (
          <>
            <Field id="address" label="Address">
              <Input id="address" value={form.address} onChange={set('address')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="city" label="City">
                <Input id="city" value={form.city} onChange={set('city')} />
              </Field>
              <Field id="country" label="Country">
                <Select id="country" value={form.country} onChange={setCountry}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field id="state" label={subdivisionLabel(form.country)}>
                {regions.length > 0 ? (
                  <Select id="state" value={form.state} onChange={set('state')}>
                    <option value="">Choose {subdivisionLabel(form.country).toLowerCase()}</option>
                    {regions.map((r) => <option key={r.shortCode} value={r.name}>{r.name}</option>)}
                  </Select>
                ) : (
                  <Input id="state" value={form.state} onChange={set('state')} />
                )}
              </Field>
              <Field id="postal_code" label={form.country === 'India' ? 'PIN code' : 'Postal code'}>
                <Input id="postal_code" value={form.postal_code} onChange={set('postal_code')} inputMode="numeric" />
                <PincodeHint postalCode={form.postal_code} country={form.country}
                             onApply={(r) => setForm((f) => ({ ...f, city: r.city, state: r.state }))} />
              </Field>
            </div>
            <Field id="phone" label="Phone">
              <Input id="phone" type="tel" value={form.phone} onChange={set('phone')} />
            </Field>
            <Field id="email" label="Business email" hint="Where customers reply to your invoices.">
              <Input id="email" type="email" value={form.email} onChange={set('email')} />
            </Field>
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink-700">On the map</p>
                <LocateButton
                  onCoords={setCoords}
                  onFound={(found) => setForm((f) => ({
                    ...f,
                    address: found.address || f.address,
                    city: found.city || f.city,
                    state: found.state || f.state,
                    postal_code: found.postal_code || f.postal_code,
                    country: found.country || f.country
                  }))}
                />
              </div>
              <MapPreview address={form.address} city={form.city} state={form.state} country={form.country} coords={coords} />
            </div>
          </>
        )}

        {index === 1 && <LogoStep logoUrl={form.logo_url} onChange={(logo_url) => setForm((f) => ({ ...f, logo_url }))} />}

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
