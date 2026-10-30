/* Email: the business's own mailbox (SMTP) in Settings, a send panel for documents and receipts, and the log. */
import { useEffect, useState } from 'react';
import { useLoad } from '../api.js';
import { showTime } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Table, useAction } from '../ui.jsx';

const TONE = { SENT: 'SENT', FAILED: 'FAILED_VALIDATION' };

/** True once the platform mailbox exists and the business has turned email on, so the Send email button only shows then. */
export const useEmailOn = () => {
  const { o, org } = useSession();
  const d = useLoad(() => o('/email/settings'), [org.id]).data;
  return Boolean(d?.available && d.enabled);
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
        <Field label="To" hint="Leave empty to use the email saved on the customer or vendor"><input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
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
  const [f, setF] = useState(null);
  useEffect(() => { const d = load.data; if (d) setF({ enabled: d.enabled, replyTo: d.replyTo, bccSelf: d.bccSelf }); }, [load.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/email/settings', { method: 'PUT', body: { enabled: f.enabled, replyTo: f.replyTo.trim(), bccSelf: f.bccSelf } }); await load.reload(); }, 'Saved.'); };
  return <Async load={load}>{(d) => f && (<>
    <Err>{a.error}</Err><Note>{a.done}</Note>
    <Card title="Email">
      <p className="muted">Invoices, quotes, orders and receipts are emailed from FlowBook's own address and show your business name ("{org.name} via FlowBook"). You do not need a mail account or password. When your customer replies, it comes to you.</p>
      {!d.available && <p className="notice warn">Email is not switched on for this server yet. Whoever runs the server needs to set up its mailbox (the same one FlowXP uses for its own emails).</p>}
      <form className="form" onSubmit={save}>
        <p className="check wide"><input id="em-on" type="checkbox" checked={f.enabled} onChange={set('enabled')} /><label htmlFor="em-on">Send documents by email</label></p>
        <Field label="Replies go to" hint="Leave empty to use the email in your business profile"><input type="email" value={f.replyTo} onChange={set('replyTo')} /></Field>
        <p className="check wide"><input id="em-bcc" type="checkbox" checked={f.bccSelf} onChange={set('bccSelf')} /><label htmlFor="em-bcc">Send me a copy of each email</label></p>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn></div>
      </form>
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
