/*
 * Help for someone who is not an accountant: a Help button in the header opens a panel with three things.
 *  - This page: what the screen is for and the steps to do the usual thing on it.
 *  - Words: the accounting and GST words, in plain language (also available inline: <Term k="HSN" />).
 *  - Ask: the assistant, which reads the person's own books and answers in simple words. It never changes anything.
 * Other screens can open the panel with a question already typed (useHelp().ask).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from './session.jsx';
import { Btn } from './ui.jsx';

export const GLOSSARY = {
  GST: ['GST', 'The tax added on what you sell. You collect it from customers and pay it to the government, after taking off the GST you paid on your own purchases.'],
  GSTIN: ['GSTIN', 'Your 15-character GST registration number. It decides how tax is split on invoices. Leave it empty if you are not registered for GST.'],
  HSN: ['HSN / SAC code', 'A number that says what kind of goods (HSN) or service (SAC) this is. GST returns ask for it. If you do not know it, leave it as it is: the item usually fills it in.'],
  POS: ['Place of supply', 'The state the sale is delivered to. Same state as your business: tax is split as CGST + SGST. Different state: it is one IGST. "Automatic" works it out from the customer.'],
  CGST: ['CGST, SGST, IGST', 'The three parts GST can be split into. Same-state sales have CGST + SGST (half each). Sales to another state have IGST (all of it).'],
  TDS: ['TDS', 'Tax that a customer keeps back from your payment and deposits with the government for you. You then claim it later. Only fill it in if the customer actually deducted it.'],
  TCS: ['TCS', 'Tax collected at source: extra tax some sellers must collect on top of the sale. Leave it empty unless the law requires it for what you sell.'],
  ROUND: ['Round off', 'Rounds the total to the nearest rupee, so a bill of ₹319.20 becomes ₹319. The few paise are kept in a small "round off" line.'],
  DRAFT: ['Draft, Issue, Void', 'A draft can still be changed and has no number. Issue gives it its number and records it in your books. An issued invoice cannot be edited; if it was wrong, void it or make a credit note.'],
  CREDIT: ['Credit note', 'A note that reduces what a customer owes you, for a return or a price correction. It is the proper way to correct an issued invoice.'],
  DEBIT: ['Debit note', 'The same thing for a vendor: reduces what you owe them, for goods you returned.'],
  RECEIVABLE: ['Customers owe you', 'The total of your issued invoices that customers have not paid yet. Books call this "accounts receivable".'],
  PAYABLE: ['You owe vendors', 'The total of vendor bills you have not paid yet. Books call this "accounts payable".'],
  PNL: ['Profit and loss', 'Money you earned minus money you spent, over a period. It answers "did I make a profit?"'],
  BS: ['Balance sheet', 'A snapshot of what the business owns, owes and is worth on one day.'],
  TB: ['Trial balance', 'A list of every account with its total. Its two sides must match; that is how your accountant checks the books add up.'],
  JOURNAL: ['Journal entry', 'One line in the books that moves money from one account to another. Invoices and payments make their own; you only write one by hand for special cases.'],
  RECON: ['Bank reconciliation', 'Ticking off your bank statement against your books, line by line, so you know they agree.'],
  RCM: ['Reverse charge', 'A few purchases where you, not the seller, pay the GST. Only tick it when your accountant says the bill is under reverse charge.'],
  FY: ['Financial year', 'April to March. FlowBook shows this year by default.'],
  OPENING: ['Opening balances', 'What you already owned or owed on the day you started in FlowBook, such as old customer dues and bank balance.']
};

/** What each screen is for, the usual steps, and questions worth asking the assistant there. Longest matching path wins. */
const TIPS = [
  ['/', { title: 'Home', about: 'A quick look at how the business is doing today.', steps: ['The four boxes show what customers owe you, what is overdue, what you owe vendors and your profit this year.', 'Press New invoice when you sell something.', 'Press Record payment when money comes in or goes out.'], ask: ['Who owes me money?', 'How is my business doing this year?', 'What GST do I have to pay this month?'] }],
  ['/sales/new', { title: 'Making an invoice', about: 'A bill you give a customer.', steps: ['Choose the customer (add them first if they are new).', 'Press Add line for each thing you sold: pick the item, type the quantity. Price and GST fill in on their own.', 'Press Save draft, check the total, then press Issue. Issuing gives it a number and records the sale.'], ask: ['What is a draft invoice?', 'Which GST rate should I use?'] }],
  ['/sales', { title: 'Invoices', about: 'Every bill you have given to customers.', steps: ['Press New invoice to make one.', 'Click an invoice to see it, print it, send it on WhatsApp or record a payment against it.', 'Use the Drafts and Issued tabs to find what you need.'], ask: ['Which invoices are not paid yet?', 'How much did I sell this month?'] }],
  ['/customers', { title: 'Customers', about: 'The people and businesses you sell to.', steps: ['Press Add customer and type the name. Phone and GSTIN are optional.', 'Credit days is how long they usually take to pay; it sets the due date on their invoices.'], ask: ['Who are my best customers?'] }],
  ['/vendors', { title: 'Vendors', about: 'The people and businesses you buy from.', steps: ['Press Add vendor and type the name.', 'Record what they bill you under Bills, and what you pay them under Payments.'], ask: ['How much do I owe my vendors?'] }],
  ['/payments/new', { title: 'Recording a payment', about: 'When money comes in from a customer, or you pay a vendor.', steps: ['Choose Received (a customer paid you) or Paid (you paid a vendor).', 'Choose who, the date, how it was paid and the amount.', 'Tick the invoices it settles, or press Fill oldest first. Then Record payment.'], ask: ['What is TDS?', 'What if the customer paid only part?'] }],
  ['/payments', { title: 'Payments', about: 'Money received from customers and paid to vendors.', steps: ['Press Money received when a customer pays you.', 'Press Money paid when you pay a vendor.'], ask: ['How much money came in this month?'] }],
  ['/purchases', { title: 'Bills', about: 'What vendors have billed you.', steps: ['Press New bill, choose the vendor and add what you bought.', 'Issue it to record it. Pay it later under Payments.'], ask: ['Which bills are still unpaid?'] }],
  ['/expenses', { title: 'Expenses', about: 'Running costs such as rent, electricity and salaries.', steps: ['Press Add expense, choose the kind of cost and the amount.', 'It shows up in your profit and loss.'], ask: ['What did I spend the most on?'] }],
  ['/items', { title: 'Items', about: 'What you sell or buy, with its price and GST.', steps: ['Add each product or service once, with its selling price and GST rate.', 'Then you only pick it on an invoice and the price fills in.'], ask: ['What is an HSN code?'] }],
  ['/stock', { title: 'Stock', about: 'How many of each thing you have.', steps: ['Buying adds to stock and selling takes from it.', 'Use Adjust stock after a count if the numbers are different.'], ask: ['Which items am I running low on?'] }],
  ['/reports', { title: 'Reports', about: 'Answers about the business, ready to read or print.', steps: ['Pick a report on top.', 'Change the dates to look at any period.', 'Press Explain in simple words to have the assistant read it out for you.'], ask: ['Did I make a profit this year?', 'Explain my GST for last month'] }],
  ['/settings', { title: 'Settings', about: 'Your business details and how documents look.', steps: ['Business: name, GSTIN and address, which appear on invoices.', 'Printing: choose how your invoice looks.', 'Team: give someone else access.'], ask: ['What is a GSTIN?'] }]
];
const tipsFor = (path) => (TIPS.filter(([p]) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`))).sort((a, b) => b[0].length - a[0].length)[0] || [null, { title: 'This screen', about: 'Use the menu on the left to move around.', steps: ['Home shows the big picture.', 'Invoices is where you bill customers.', 'Payments is where you record money coming in or going out.'], ask: ['Where do I make an invoice?', 'How do I record a payment?'] }])[1];

const Ctx = createContext({ open: false, setOpen() {}, ask() {}, pending: null, clearPending() {} });
export const useHelp = () => useContext(Ctx);

export const HelpProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const value = useMemo(() => ({ open, setOpen, pending, ask: (q) => { setPending(q); setOpen(true); }, clearPending: () => setPending(null) }), [open, pending]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const HelpButton = () => {
  const { setOpen } = useHelp();
  return <button className="btn small help-btn" onClick={() => setOpen(true)} aria-haspopup="dialog"><span aria-hidden="true">?</span> Help</button>;
};

/** A word that explains itself when tapped: <Term k="HSN" />, or <Term k="TDS">TDS deducted</Term> for other wording. */
export const Term = ({ k, children }) => {
  const [on, setOn] = useState(false);
  const g = GLOSSARY[k];
  if (!g) return children ?? k;
  return (
    <span className="term-wrap">
      <button type="button" className="term" aria-expanded={on} onClick={(e) => { e.preventDefault(); setOn(!on); }}>{children ?? g[0]}<span aria-hidden="true" className="term-q">?</span></button>
      {on && <span className="term-pop" role="note"><strong>{g[0]}.</strong> {g[1]}</span>}
    </span>
  );
};

/** Plain text from the assistant: "- " lines become bullets, **bold** is kept, nothing else is interpreted (no HTML). */
const Reply = ({ text }) => {
  const bold = (s) => s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p));
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((x, i) => <li key={i}>{bold(x)}</li>)}</ul>); list = []; } };
  for (const line of text.split('\n')) {
    const m = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (m) list.push(m[1]); else { flush(); if (line.trim()) out.push(<p key={out.length}>{bold(line)}</p>); }
  }
  flush();
  return <>{out}</>;
};

const Ask = ({ page, suggestions }) => {
  const { o, org } = useSession();
  const { pending, clearPending } = useHelp();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(null);
  const [why, setWhy] = useState('');
  const end = useRef(null);
  useEffect(() => { o('/assistant/status').then((s) => { setAvailable(s.available); setWhy(s.message || ''); }, () => setAvailable(false)); }, [org.id]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [msgs, busy]);

  const send = async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, { role: 'user', text: q }]); setText(''); setBusy(true);
    try {
      const r = await o('/assistant', { method: 'POST', body: { question: q, page, history } });
      setMsgs((m) => [...m, { role: 'assistant', text: r.answer, used: r.used }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true }]); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (pending && available !== null) { clearPending(); if (available) send(pending); } }, [pending, available]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (available === false) return <p className="notice warn">{why || 'The assistant is not switched on for your account yet.'} The <strong>This page</strong> and <strong>Words</strong> tabs still have answers.</p>;
  return (
    <div className="ask">
      <div className="ask-log" aria-live="polite">
        {!msgs.length && <>
          <p className="muted">Ask anything about your business or about using FlowBook, in your own words. I only read your books; I never change anything.</p>
          <div className="chips">{suggestions.map((s) => <button key={s} className="chip-btn" onClick={() => send(s)}>{s}</button>)}</div>
        </>}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role} ${m.error ? 'err' : ''}`}>
            {m.role === 'user' ? m.text : <Reply text={m.text} />}
            {m.used?.length > 0 && <p className="used">Looked at: {m.used.join(', ')}</p>}
          </div>
        ))}
        {busy && <div className="bubble assistant"><span className="spinner" aria-hidden="true" /> Looking at your books…</div>}
        <div ref={end} />
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question" maxLength={800} aria-label="Your question" disabled={available === null} />
        <Btn kind="primary" busy={busy} disabled={!text.trim() || available === null}>Ask</Btn>
      </form>
    </div>
  );
};

const PageHelp = ({ tips, onAsk }) => (
  <div>
    <h3>{tips.title}</h3>
    <p>{tips.about}</p>
    <ol className="steps">{tips.steps.map((s) => <li key={s}>{s}</li>)}</ol>
    {tips.ask?.length > 0 && <><p className="muted">Not sure? Ask:</p><div className="chips">{tips.ask.map((q) => <button key={q} className="chip-btn" onClick={() => onAsk(q)}>{q}</button>)}</div></>}
  </div>
);

const Words = () => {
  const [q, setQ] = useState('');
  const rows = Object.values(GLOSSARY).filter(([t, d]) => `${t} ${d}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Look up a word, such as GST or TDS" aria-label="Look up a word" />
      <dl className="words">{rows.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
      {!rows.length && <p className="muted">No word like that. Try asking the assistant.</p>}
    </div>
  );
};

export const HelpPanel = () => {
  const { open, setOpen, pending, ask } = useHelp();
  const { pathname } = useLocation();
  const [tab, setTab] = useState('page');
  const tips = tipsFor(pathname);
  useEffect(() => { if (pending) setTab('ask'); }, [pending]);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <>
      <div className="backdrop help-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="help-panel" role="dialog" aria-label="Help">
        <div className="help-head"><h2>Help</h2><button className="icon-btn" aria-label="Close help" onClick={() => setOpen(false)}>✕</button></div>
        <div className="tabs" role="tablist">{[['page', 'This page'], ['ask', 'Ask'], ['words', 'Words']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="help-body">
          {tab === 'page' && <PageHelp tips={tips} onAsk={ask} />}
          {tab === 'ask' && <Ask page={pathname} suggestions={tips.ask?.length ? tips.ask : ['Who owes me money?', 'How is my business doing this year?']} />}
          {tab === 'words' && <Words />}
        </div>
      </aside>
    </>
  );
};
