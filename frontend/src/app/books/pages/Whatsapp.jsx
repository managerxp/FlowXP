/* WhatsApp: the settings, a send button for invoices and receipts, and the message log. */
import { useEffect, useState } from 'react';
import { useLoad } from '../api.js';
import { showTime } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Table, useAction } from '../ui.jsx';

const TONE = { SENT: 'SENT', OPENED: 'POSTED', SKIPPED: 'NEEDS_ATTENTION', FAILED: 'FAILED_VALIDATION' };
const KIND = { INVOICE: 'Invoice', REMINDER: 'Reminder', RECEIPT: 'Receipt' };

/** One button. In LINK mode it opens WhatsApp with the message ready; in CLOUD mode FlowBook sends it. */
export const WhatsappButton = ({ kind, documentId, paymentId, label, onDone }) => {
  const { o, org } = useSession();
  const s = useLoad(() => o('/whatsapp/settings'), [org.id]);
  const a = useAction();
  if (!s.data || s.data.mode === 'OFF') return null;
  const click = () => {
    // open the tab now, while the click still counts, and point it at WhatsApp once the message is ready
    const w = s.data.mode === 'LINK' ? window.open('', '_blank') : null;
    if (w) w.opener = null;
    a.run(async () => {
      let r;
      try { r = await o('/whatsapp/send', { method: 'POST', body: { kind, ...(documentId && { documentId: String(documentId) }), ...(paymentId && { paymentId: String(paymentId) }) } }); } catch (e) { w?.close(); throw e; }
      if (r.url && w) w.location.href = r.url; else w?.close();
      onDone?.();
      if (r.status === 'FAILED' || r.status === 'SKIPPED') throw new Error(r.error);
    }, s.data.mode === 'CLOUD' ? 'Sent on WhatsApp.' : 'WhatsApp opened with the message ready. Press send there.');
  };
  return <>
    <Btn busy={a.busy} onClick={click}>{label}</Btn>
    {a.error && <span className="notice bad" role="alert">{a.error}</span>}{a.done && <span className="notice ok" role="status">{a.done}</span>}
  </>;
};

export const WhatsappLog = ({ documentId, refresh }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/whatsapp/messages?documentId=${documentId}&limit=20`), [org.id, documentId, refresh]);
  if (!load.data?.length) return null;
  return (
    <Card title="WhatsApp messages">
      <Table head={['When', 'What', 'To', 'Result']}>
        {load.data.map((m) => <tr key={m.id}><td>{showTime(m.created_at)}</td><td>{KIND[m.kind]}{m.auto ? ' (automatic)' : ''}</td><td>{m.to_phone}</td>
          <td><Badge status={TONE[m.status]}>{m.status === 'OPENED' ? 'opened for sending' : m.status.toLowerCase()}</Badge>{m.error && <div className="muted">{m.error}</div>}</td></tr>)}
      </Table>
    </Card>
  );
};

const OFFSETS = (list) => list.map((n) => (n < 0 ? `${-n} days before` : n === 0 ? 'on the due date' : `${n} days after`)).join(', ');

export const WhatsappSettings = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/whatsapp/settings'), [org.id]);
  const a = useAction();
  const [f, setF] = useState(null);
  useEffect(() => { const d = load.data; if (d) setF({ mode: d.mode, phoneNumberId: d.phoneNumberId || '', token: '', language: d.language, autoReminders: d.autoReminders, offsets: d.reminderOffsets.join(', '),
    templateInvoice: d.templateInvoice, templateReminder: d.templateReminder, templateReceipt: d.templateReceipt }); }, [load.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const offsets = f.offsets.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
      if (offsets.some((n) => !Number.isInteger(n))) throw new Error('Reminder days must be whole numbers, like -3, 0, 7');
      await o('/whatsapp/settings', { method: 'PUT', body: { mode: f.mode, language: f.language, autoReminders: f.autoReminders && f.mode === 'CLOUD', reminderOffsets: offsets,
        templateInvoice: f.templateInvoice, templateReminder: f.templateReminder, templateReceipt: f.templateReceipt, ...(f.phoneNumberId && { phoneNumberId: f.phoneNumberId }), ...(f.token && { token: f.token }) } });
      await load.reload();
    }, 'Saved.');
  };
  return <Async load={load}>{(d) => f && (<>
    <Err>{a.error}</Err><Note>{a.done}</Note>
    <Card title="WhatsApp">
      <form className="form" onSubmit={save}>
        <Field label="How messages go" wide hint="Link: WhatsApp opens with the message ready and you press send. Send from FlowBook: it sends for you through your own WhatsApp Business number, and can remind on its own.">
          <select value={f.mode} onChange={set('mode')}><option value="LINK">Open WhatsApp (nothing to set up)</option><option value="CLOUD">Send from FlowBook (Meta WhatsApp Cloud API)</option><option value="OFF">Off</option></select>
        </Field>
        {f.mode === 'CLOUD' && <>
          {d.platform && !d.hasToken && <p className="notice wide">Messages go out from the FlowXP WhatsApp number, so there is nothing to set up. To send from your own WhatsApp Business number instead, fill in the two boxes below.</p>}
          <Field label="Phone number ID" hint="From Meta Business Manager, WhatsApp, API setup"><input value={f.phoneNumberId} onChange={set('phoneNumberId')} inputMode="numeric" /></Field>
          <Field label="Access token" hint={d.hasToken ? 'A token is saved. Leave empty to keep it.' : 'Use a permanent token'}><input type="password" value={f.token} onChange={set('token')} autoComplete="off" /></Field>
          <Field label="Template language"><input value={f.language} onChange={set('language')} maxLength={5} /></Field>
          <Field label="Invoice template name"><input value={f.templateInvoice} onChange={set('templateInvoice')} /></Field>
          <Field label="Reminder template name"><input value={f.templateReminder} onChange={set('templateReminder')} /></Field>
          <Field label="Receipt template name"><input value={f.templateReceipt} onChange={set('templateReceipt')} /></Field>
          <p className="check wide"><input id="auto" type="checkbox" checked={f.autoReminders} onChange={set('autoReminders')} /><label htmlFor="auto">Remind customers automatically about unpaid invoices</label></p>
          {f.autoReminders && <Field label="When" wide hint={`Days from the due date, like -3, 0, 7, 15 (${OFFSETS(f.offsets.split(',').map(Number).filter(Number.isInteger))}). Each invoice gets each reminder once.`}><input value={f.offsets} onChange={set('offsets')} /></Field>}
        </>}
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn></div>
      </form>
    </Card>
    {f.mode === 'CLOUD' && (
      <Card title="Templates to create in Meta">
        <p className="muted">Meta only lets a business start a chat with an approved template. Create these three as <strong>Utility</strong> templates, with the names above and exactly this text, and wait for approval. Messages go to people who gave you their number; people can opt out on their customer record.</p>
        {Object.entries(d.templateBodies).map(([k, v]) => <p key={k}><strong>{KIND[k]}:</strong> <code>{v}</code></p>)}
        <p className="muted">This has not been tested against WhatsApp's live service. Send one to yourself first.</p>
      </Card>
    )}
    <Card title="Latest messages"><Latest /></Card>
  </>)}</Async>;
};

const Latest = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/whatsapp/messages?limit=30'), [org.id]);
  return <Async load={load}>{(rows) => (
    <Table head={['When', 'Who', 'What', 'Result']} empty={!rows.length && <Empty>Nothing sent yet.</Empty>}>
      {rows.map((m) => <tr key={m.id}><td>{showTime(m.created_at)}</td><td>{m.party_name}</td><td>{KIND[m.kind]}{m.auto ? ' (automatic)' : ''}</td><td><Badge status={TONE[m.status]}>{m.status.toLowerCase()}</Badge>{m.error && <div className="muted">{m.error}</div>}</td></tr>)}
    </Table>
  )}</Async>;
};
