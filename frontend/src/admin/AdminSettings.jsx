/*
 * Platform config that used to be .env-only, now admin-editable (owner's
 * request, 2026-09-29): which payment gateway is live and its keys, and
 * which email/SMS/WhatsApp provider is live and its credentials. A secret
 * field the server already has comes back masked (••••••••) and is never
 * sent again unless retyped — leaving it as-is on Save keeps the saved one.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Select, Button, Alert, useToast } from '../components/ui.jsx';

const MASKED = '••••••••';

/** A password-style field: typing replaces the mask; leaving it untouched sends nothing. */
const SecretField = ({ id, label, value, onChange }) => (
  <Field id={id} label={label}>
    <Input
      id={id}
      type="password"
      value={value}
      placeholder={value === MASKED ? 'Saved — leave blank to keep it' : ''}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => { if (value === MASKED) onChange(''); }}
    />
  </Field>
);

/** Loads one settings group, tracks edits, and saves only the changed fields. */
const useSettingsForm = (path) => {
  const toast = useToast();
  const [saved, setSaved] = useState(null); // last value from the server
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi(path).then((data) => { setSaved(data); setForm(data); }).catch((err) => setError(err.message));
  }, [path]);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // A secret field left at the mask means "unchanged" — send it as blank so the
      // server's merge rule (setPlatformSetting) keeps whatever it already has.
      const body = { ...form };
      for (const key of Object.keys(body)) if (body[key] === MASKED) body[key] = '';
      const updated = await adminApi(path, { method: 'PUT', body });
      setSaved(updated);
      setForm(updated);
      toast.success('Saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved);
  return { form, set, save, saving, dirty, error };
};

const PaymentGatewaySettings = () => {
  const { form, set, save, saving, dirty, error } = useSettingsForm('/settings/payment-gateway');
  if (!form) return null;

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-400">Payment gateway</h3>
      <p className="mb-4 text-sm text-ink-500">
        Cashfree is the only gateway wired up today. Switching to another provider later needs its own adapter,
        but its keys will live here the same way — no code deploy for a key rotation or environment change.
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="pg-provider" label="Provider">
          <Select id="pg-provider" value={form.provider} onChange={(e) => set('provider')(e.target.value)}>
            <option value="cashfree">Cashfree</option>
            <option value="razorpay" disabled>Razorpay (not wired up yet)</option>
          </Select>
        </Field>
        <Field id="pg-env" label="Environment">
          <Select id="pg-env" value={form.cashfreeEnv} onChange={(e) => set('cashfreeEnv')(e.target.value)}>
            <option value="SANDBOX">Sandbox (testing)</option>
            <option value="PRODUCTION">Production (real money)</option>
          </Select>
        </Field>
        <Field id="pg-app-id" label="App ID">
          <Input id="pg-app-id" value={form.cashfreeAppId} onChange={(e) => set('cashfreeAppId')(e.target.value)} />
        </Field>
        <SecretField id="pg-secret" label="Secret key" value={form.cashfreeSecretKey} onChange={set('cashfreeSecretKey')} />
      </div>
      <Button className="mt-4" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
    </Card>
  );
};

const EmailSettings = () => {
  const { form, set, save, saving, dirty, error } = useSettingsForm('/settings/email');
  if (!form) return null;

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-400">Email (SMTP)</h3>
      <p className="mb-4 text-sm text-ink-500">Leave the host blank to keep email off — messages are logged, not sent.</p>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="em-host" label="SMTP host">
          <Input id="em-host" value={form.smtpHost} onChange={(e) => set('smtpHost')(e.target.value)} placeholder="smtp.example.com" />
        </Field>
        <Field id="em-port" label="Port">
          <Input id="em-port" type="number" value={form.smtpPort} onChange={(e) => set('smtpPort')(e.target.value)} />
        </Field>
        <Field id="em-user" label="Username">
          <Input id="em-user" value={form.smtpUser} onChange={(e) => set('smtpUser')(e.target.value)} />
        </Field>
        <SecretField id="em-pass" label="Password" value={form.smtpPass} onChange={set('smtpPass')} />
        <Field id="em-from" label="From address">
          <Input id="em-from" value={form.mailFrom} onChange={(e) => set('mailFrom')(e.target.value)} placeholder="FlowXP <flowxp.manager@gmail.com>" />
        </Field>
      </div>
      <Button className="mt-4" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
    </Card>
  );
};

const MessagingSettings = () => {
  const { form, set, save, saving, dirty, error } = useSettingsForm('/settings/messaging');
  if (!form) return null;
  const provider = form.provider;

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-400">SMS &amp; WhatsApp</h3>
      <p className="mb-4 text-sm text-ink-500">"Log" sends nothing and only records the message — the safe default until a provider is set up.</p>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="msg-provider" label="Provider">
          <Select id="msg-provider" value={provider} onChange={(e) => set('provider')(e.target.value)}>
            <option value="log">Log only (nothing sent)</option>
            <option value="whatsapp_cloud">WhatsApp Cloud API (Meta)</option>
            <option value="twilio">Twilio (SMS / WhatsApp)</option>
          </Select>
        </Field>
        <Field id="msg-country" label="Default country code">
          <Input id="msg-country" value={form.countryCode} onChange={(e) => set('countryCode')(e.target.value)} placeholder="91" />
        </Field>
      </div>

      {provider === 'whatsapp_cloud' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SecretField id="msg-wa-token" label="WhatsApp access token" value={form.whatsappToken} onChange={set('whatsappToken')} />
          <Field id="msg-wa-phone" label="WhatsApp phone number ID">
            <Input id="msg-wa-phone" value={form.whatsappPhoneId} onChange={(e) => set('whatsappPhoneId')(e.target.value)} />
          </Field>
          <Field id="msg-wa-lang" label="Template language">
            <Input id="msg-wa-lang" value={form.whatsappLanguage} onChange={(e) => set('whatsappLanguage')(e.target.value)} placeholder="en" />
          </Field>
        </div>
      )}

      {provider === 'twilio' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="msg-tw-sid" label="Twilio Account SID">
            <Input id="msg-tw-sid" value={form.twilioSid} onChange={(e) => set('twilioSid')(e.target.value)} />
          </Field>
          <SecretField id="msg-tw-token" label="Twilio auth token" value={form.twilioToken} onChange={set('twilioToken')} />
          <Field id="msg-tw-from" label="SMS sender number">
            <Input id="msg-tw-from" value={form.twilioFrom} onChange={(e) => set('twilioFrom')(e.target.value)} placeholder="+1..." />
          </Field>
          <Field id="msg-tw-wa-from" label="WhatsApp sender (optional)">
            <Input id="msg-tw-wa-from" value={form.twilioWhatsappFrom} onChange={(e) => set('twilioWhatsappFrom')(e.target.value)} placeholder="+1..." />
          </Field>
        </div>
      )}

      <Button className="mt-4" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
    </Card>
  );
};

const AdminSettings = () => (
  <div>
    <PageHeader
      title="Settings"
      lead="Platform config that used to need a code deploy — the payment gateway and the messaging providers. A blank field keeps whatever is set in the server's .env; a value here overrides it, no restart needed."
    />
    <div className="grid gap-4 lg:grid-cols-2">
      <PaymentGatewaySettings />
      <EmailSettings />
      <MessagingSettings />
    </div>
  </div>
);

export default AdminSettings;
