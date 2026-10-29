/* Email: the business's own mailbox (SMTP) in Settings, a send panel for documents and receipts, and the log. */
import { useEffect, useState } from 'react';
import { useLoad } from '../api.js';
import { showTime } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Table, useAction } from '../ui.jsx';

const TONE = { SENT: 'SENT', FAILED: 'FAILED_VALIDATION' };

/** True once the business has turned email on, so the Send email button only shows then. */
export const useEmailOn = () => {
  const { o, org } = useSession();
  return Boolean(useLoad(() => o('/email/settings'), [org.id]).data?.enabled);
};

/** Who to send to (empty = the party's own email) and an optional note. */
export const EmailForm = ({ documentId, paymentId, onDone, onClose }) => {
  const { o } = useSession();
  const a = useAction();
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const send = () => a.run(async () => {
    const r = await o('/email/send', { method: 'POST', body: { ...(documentId && { documentId: String(documentId) }), ...(paymentId && { paymentId: String(paymentId) }), ...(to.trim() && { to: to.trim() }), ...(message.trim() && { message: message.trim() }) } });
    onDone?.();
    if (r.status === 'FAILED') throw new Error(r.error || 'The mail server refused it.');
    onClose();
  }, 'Email sent.');
  return (
    <Card title="Send by email">
      <div className="form">
        <Field label="To" hint="Leave empty to use the email on the customer's record"><input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Note (optional)" wide><textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
      <Err>{a.error}</Err>
      <p className="actions"><Btn kind="primary" busy={a.busy} onClick={send}>Send</Btn><Btn onClick={onClose}>Cancel</Btn></p>
    </Card>
  );
};

export const EmailLog = ({ documentId, paymentId, refresh }) => {
  const { o, org } = useSession();
  const q = documentId ? `documentId=${documentId}` : `paymentId=${paymentId}`;
  const load = useLoad(() => o(`/email/messages?${q}&limit=20`), [org.id, documentId, paymentId, refresh]);
  if (!load.data?.length) return null;
  return (
    <Card title="Emails sent">
      <Table head={['When', 'To', 'Result']}>
        {load.data.map((m) => <tr key={m.id}><td>{showTime(m.created_at)}</td><td>{m.to_email}</td>
          <td><Badge status={TONE[m.status]}>{m.status.toLowerCase()}</Badge>{m.error && <div className="muted">{m.error}</div>}</td></tr>)}
      </Table>
    </Card>
  );
};

export const EmailSettings = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/email/settings'), [org.id]);
  const a = useAction();
  const t = useAction();
  const [f, setF] = useState(null);
  useEffect(() => { const d = load.data; if (d) setF({ enabled: d.enabled, host: d.host, port: String(d.port), secure: d.secure, username: d.username, password: '', fromName: d.fromName, fromEmail: d.fromEmail, replyTo: d.replyTo, bccSelf: d.bccSelf }); }, [load.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const body = () => ({ enabled: f.enabled, host: f.host.trim(), port: Number(f.port) || 587, secure: f.secure, username: f.username, fromName: f.fromName, fromEmail: f.fromEmail.trim(), replyTo: f.replyTo.trim(), bccSelf: f.bccSelf, ...(f.password && { password: f.password }) });
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/email/settings', { method: 'PUT', body: body() }); await load.reload(); }, 'Saved.'); };
  const test = () => t.run(async () => {
    await o('/email/settings', { method: 'PUT', body: body() }); await load.reload();
    const r = await o('/email/test', { method: 'POST', body: {} });
    if (!r.ok) throw new Error(`The mail server said: ${r.error}`);
  }, 'Connected and logged in. Nothing was sent.');
  return <Async load={load}>{(d) => f && (<>
    <Err>{a.error}</Err><Note>{a.done}</Note>
    <Card title="Email">
      <p className="muted">Invoices, quotes, orders and receipts go from your own mailbox, so your customers see your address. Gmail and most providers need an "app password" (not your normal password) and the mail server name from their help page.</p>
      <form className="form" onSubmit={save}>
        <p className="check wide"><input id="em-on" type="checkbox" checked={f.enabled} onChange={set('enabled')} /><label htmlFor="em-on">Send documents by email</label></p>
        <Field label="Mail server" hint="like smtp.gmail.com"><input value={f.host} onChange={set('host')} autoComplete="off" /></Field>
        <Field label="Port" hint="587 for most, 465 if secure"><input inputMode="numeric" value={f.port} onChange={set('port')} /></Field>
        <p className="check wide"><input id="em-sec" type="checkbox" checked={f.secure} onChange={set('secure')} /><label htmlFor="em-sec">Secure connection from the start (port 465)</label></p>
        <Field label="Login name"><input value={f.username} onChange={set('username')} autoComplete="off" /></Field>
        <Field label="Password" hint={d.hasPassword ? 'A password is saved. Leave empty to keep it.' : 'App password'}><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Field label="Sender name"><input value={f.fromName} onChange={set('fromName')} /></Field>
        <Field label="Sent from address"><input type="email" value={f.fromEmail} onChange={set('fromEmail')} /></Field>
        <Field label="Replies go to (optional)"><input type="email" value={f.replyTo} onChange={set('replyTo')} /></Field>
        <p className="check wide"><input id="em-bcc" type="checkbox" checked={f.bccSelf} onChange={set('bccSelf')} /><label htmlFor="em-bcc">Send myself a copy of each email</label></p>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" busy={t.busy} onClick={test}>Save and test the login</Btn></div>
      </form>
      <Err>{t.error}</Err><Note>{t.done}</Note>
      <p className="muted">This has not been tested against a real mail server. Test the login, then send one to yourself first.</p>
    </Card>
    <Card title="Latest emails"><Latest /></Card>
  </>)}</Async>;
};

const Latest = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/email/messages?limit=30'), [org.id]);
  return <Async load={load}>{(rows) => (
    <Table head={['When', 'To', 'Subject', 'Result']} empty={!rows.length && <Empty>Nothing sent yet.</Empty>}>
      {rows.map((m) => <tr key={m.id}><td>{showTime(m.created_at)}</td><td>{m.to_email}</td><td>{m.subject}</td><td><Badge status={TONE[m.status]}>{m.status.toLowerCase()}</Badge>{m.error && <div className="muted">{m.error}</div>}</td></tr>)}
    </Table>
  )}</Async>;
};
