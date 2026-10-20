/* One member: details, memberships and what can be done to them, cards and access, and recent visits. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CreditCard, History, Pencil, Plus, QrCode, RefreshCw, ShieldOff, Snowflake, UsersRound } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { MEMBERSHIP_STATE, MEMBER_STATUS, PAYMENT_STATE, dayTime, longDate, rs, useLoad } from '../../lib/gym.js';
import { Alert, Avatar, Badge, Button, ListState, PageHeader, Select, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, useAction } from '../salon/parts.jsx';
import MemberForm from './MemberForm.jsx';
import { MemberPacks, MemberRewards, MemberTraining } from './MemberExtras.jsx';
import { CancelDialog, ExtendDialog, FreezeDialog, HistoryDialog, SellDialog, TransferDialog } from './MemberDialogs.jsx';
import { useT } from '../../i18n/useT.js';

const Row = ({ label, children }) => {
  const tr = useT();
  return (children ? <div className="flex justify-between gap-4 py-1.5 text-small"><dt className="text-ink-500">{tr(label)}</dt><dd className="min-w-0 text-right text-ink-900">{children}</dd></div> : null);
};

export default function MemberDetail() {
  const tr = useT();
  const { id } = useParams();
  const { can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const m = useLoad(`/gym/members/${id}`);
  const [form, setForm] = useState(false);
  const [family, setFamily] = useState(false);
  const [sell, setSell] = useState(null);         // { mode, membership }
  const [freeze, setFreeze] = useState(null);
  const [extend, setExtend] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, run] = useAction();
  const member = m.data;
  const desk = can('gym_desk') || can('gym_setup');
  const manager = can('gym_setup');
  const access = hasFeature('gym_access');

  if (m.error && !member) return <div><Button variant="ghost" onClick={() => navigate('/app/gym/members')}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{tr('Members')}</Button><ListState error={m.error === 'Not found' ? 'This member is not here, or belongs to another outlet.' : m.error} /></div>;
  if (!member) return <ListState loading />;

  const done = (message) => (out) => { setSell(null); setFreeze(null); setExtend(null); setCancel(null); setTransfer(null); if (message) toast.success(message); m.reload(); return out; };
  const post = (path, body, success) => run(async () => { await api(path, { method: 'POST', body: body || {} }); m.reload(); }, success);

  const setStatus = async (status) => {
    const labels = { SUSPENDED: 'Put on hold', ACTIVE: 'Make active', INACTIVE: 'Mark inactive', ARCHIVED: 'Archive' };
    const reason = status === 'ACTIVE' ? '' : await dialog.prompt({ title: `${labels[status]} ${member.name}?`, label: tr('Reason (optional)'), confirmLabel: labels[status], required: false, danger: status === 'ARCHIVED' });
    if (reason === null) return;
    await post(`/gym/members/${id}/status`, { status, reason: reason || undefined }, 'Saved');
  };

  const issueCard = async () => {
    const has = member.credentials.some((c) => c.kind === 'CARD' && c.status === 'ACTIVE');
    if (has && !await dialog.confirm({ title: tr('Replace their card?'), body: tr('The card they have now stops working at once. Use this for a lost or damaged card.'), confirmLabel: tr('Make a new card') })) return;
    await run(async () => {
      const made = await api(`/gym/members/${id}/cards`, { method: 'POST', body: { reason: has ? 'Replaced at the desk' : undefined } });
      navigate(`/app/gym/members/${id}/card`, { state: { code: made.code, name: member.name, memberCode: member.member_code } });
    }, null);
  };

  const cutOff = async () => {
    if (!await dialog.confirm({ title: tr('Cut off every way in?'), body: `${member.name}'s cards and phone pass stop working and any phone they are signed in on is signed out. They can sign in again with a new code, and you can make a new card.`, confirmLabel: tr('Cut off access'), danger: true })) return;
    await post(`/gym/members/${id}/revoke-access`, { reason: 'Revoked at the desk' }, 'Access cut off');
  };

  const memberships = member.memberships || [];
  const current = memberships.find((x) => ['ACTIVE', 'GRACE', 'FROZEN'].includes(x.state) && !x.shared_from) || memberships.find((x) => x.state === 'UPCOMING');
  const cardLive = member.credentials.find((c) => c.kind === 'CARD' && c.status === 'ACTIVE');
  const passLive = member.credentials.find((c) => c.kind === 'DIGITAL' && c.status === 'ACTIVE');

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => navigate('/app/gym/members')} className="mb-2"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{tr('Members')}</Button>
      <PageHeader title={member.name} lead={`${member.member_code} · joined ${longDate(member.joined_on)}${member.head ? ` · family of ${member.head.name}` : ''}`}
        action={<>
          <Badge tone={MEMBER_STATUS[member.status]?.tone}>{MEMBER_STATUS[member.status]?.label}</Badge>
          {(can('gym_members') || manager) && member.status !== 'ARCHIVED' && <Button variant="secondary" onClick={() => setForm(true)}><Pencil aria-hidden="true" className="h-4 w-4" />{tr('Edit')}</Button>}
          {desk && member.status !== 'ARCHIVED' && <Button onClick={() => setSell({ mode: 'sell' })}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Sell membership')}</Button>}
        </>} />
      {member.status === 'SUSPENDED' && <div className="mb-4"><Alert>This account is on hold{member.status_reason ? `: ${member.status_reason}` : ''}. They cannot check in.</Alert></div>}
      {member.status === 'ARCHIVED' && <div className="mb-4"><Alert>This member is archived{member.merged_into ? tr('(merged into another member)') : ''}. Their cards stopped working.</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Panel title={tr('Memberships')} lead={current ? `${current.plan_name} · ${current.state === 'UPCOMING' ? 'starts' : 'ends'} ${longDate(current.state === 'UPCOMING' ? current.start_date : current.end_date)}` : tr('No membership running')}>
            {memberships.length === 0 ? <p className="text-small text-ink-500">{tr('Nothing sold yet.')}</p> : (
              <ul className="divide-y divide-line">
                {memberships.map((x) => {
                  const live = x.state === 'ACTIVE' || x.state === 'GRACE' || x.state === 'FROZEN' || x.state === 'UPCOMING';
                  const own = !x.shared_from;
                  return (
                    <li key={`${x.membership_id}-${x.shared_from ?? ''}`} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-ink-900">{x.plan_name} {x.shared_from && <span className="text-caption font-normal text-ink-500">{tr('(covered by the family membership)')}</span>}</p>
                          <p className="text-small text-ink-700">{longDate(x.start_date)} to {longDate(x.end_date)}{x.days_left != null && live && x.state !== 'UPCOMING' ? ` · ${x.days_left} day${x.days_left === 1 ? '' : 's'} left` : ''}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Badge tone={MEMBERSHIP_STATE[x.state]?.tone}>{MEMBERSHIP_STATE[x.state]?.label}</Badge>
                            {x.payment !== 'NO_INVOICE' && <Badge tone={PAYMENT_STATE[x.payment]?.tone}>{PAYMENT_STATE[x.payment]?.label}</Badge>}
                            {x.amount_due > 0 && x.state !== 'CANCELLED' && <Badge tone="danger">{tr('{{rs}} due', { rs: rs(x.amount_due) })}</Badge>}
                            {(x.freezes || []).filter((f) => f.to >= new Date().toISOString().slice(0, 10)).map((f) => <Badge key={f.from} tone="brand">{tr('Frozen {{longDate}} to {{longDate2}}', { longDate: longDate(f.from), longDate2: longDate(f.to) })}</Badge>)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {x.invoice_id && x.amount_due > 0 && x.state !== 'CANCELLED' && <Button size="sm" to={`/app/billing/invoices/${x.invoice_id}`}><CreditCard aria-hidden="true" className="h-4 w-4" />{tr('Take payment')}</Button>}
                          {x.invoice_id && x.amount_due <= 0 && <Button size="sm" variant="ghost" to={`/app/billing/invoices/${x.invoice_id}`}>{tr('Bill')}</Button>}
                          {own && live && desk && <Button size="sm" variant="secondary" onClick={() => setSell({ mode: 'renew', membership: x })}><RefreshCw aria-hidden="true" className="h-4 w-4" />{tr('Renew')}</Button>}
                          {own && live && desk && x.state !== 'UPCOMING' && <Button size="sm" variant="secondary" onClick={() => setSell({ mode: 'change', membership: x })}>{tr('Change plan')}</Button>}
                          {own && live && desk && x.freeze_allowed && x.state !== 'UPCOMING' && (x.state === 'FROZEN' || (x.freezes || []).some((f) => f.to >= new Date().toISOString().slice(0, 10))
                            ? <Button size="sm" variant="secondary" onClick={() => post(`/gym/memberships/${x.membership_id}/unfreeze`, {}, 'Freeze ended')}>{tr('End freeze')}</Button>
                            : <Button size="sm" variant="secondary" onClick={() => setFreeze(x)}><Snowflake aria-hidden="true" className="h-4 w-4" />{tr('Freeze')}</Button>)}
                          {own && live && manager && <Button size="sm" variant="ghost" onClick={() => setExtend(x)}>{tr('Add days')}</Button>}
                          {own && live && manager && <Button size="sm" variant="ghost" onClick={() => setTransfer(x)}>{tr('Transfer')}</Button>}
                          {own && live && manager && <Button size="sm" variant="ghost" onClick={() => setCancel(x)}><Ban aria-hidden="true" className="h-4 w-4" />{tr('Cancel')}</Button>}
                          {own && <Button size="sm" variant="ghost" onClick={() => setHistory(x)}><History aria-hidden="true" className="h-4 w-4" />{tr('History')}</Button>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title={tr('Visits')} lead={`${member.stats.visits} in all · ${member.stats.visits_30d} in the last 30 days${member.stats.last_visit ? ` · last ${dayTime(member.stats.last_visit)}` : ''}`}>
            {member.recent_visits.length === 0 ? <p className="text-small text-ink-500">{tr('No visits yet.')}</p> : (
              <ul className="divide-y divide-line text-small">
                {member.recent_visits.map((v) => <li key={v.attendance_id} className="flex justify-between py-1.5"><span>{dayTime(v.check_in_at)}{v.check_out_at ? ` to ${new Date(v.check_out_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}</span><span className="text-ink-500">{{ RECEPTION: 'Front desk', SELF: 'Own phone', DEVICE: 'Gate' }[v.source]}</span></li>)}
              </ul>
            )}
            <div className="mt-3"><Link to={`/app/gym/attendance?member=${id}`} className="text-small text-brand-600 hover:underline">{tr('Every visit and every time they were turned away')}</Link></div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title={tr('Details')}>
            <dl className="divide-y divide-line">
              <Row label={tr('Phone')}>{member.phone}</Row>
              <Row label={tr('Email')}>{member.email}</Row>
              <Row label={tr('Born')}>{member.dob ? longDate(member.dob) : null}</Row>
              <Row label={tr('Company')}>{member.company}</Row>
              <Row label={tr('Emergency')}>{member.emergency_name ? `${member.emergency_name}${member.emergency_phone ? `, ${member.emergency_phone}` : ''}` : null}</Row>
              <Row label={tr('Details kept with consent')}>{member.consent_data_at ? tr('Yes') : tr('Not recorded')}</Row>
              <Row label={tr('Offers and reminders')}>{member.consent_marketing ? tr('Allowed') : tr('Not allowed')}</Row>
            </dl>
            {member.health_notes !== undefined && (
              <div className="mt-3 rounded-lg bg-surface-2 p-3 text-small"><p className="font-medium text-ink-900">{tr('Health notes (private)')}</p><p className="mt-1 whitespace-pre-wrap text-ink-700">{member.health_notes || 'None written.'}</p></div>
            )}
            {(can('gym_members') || manager) && member.status !== 'ARCHIVED' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="block w-60"><Select aria-label={tr('Account status')} value={member.status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
                  <option value="ACTIVE">{tr('Active')}</option><option value="SUSPENDED">{tr('On hold')}</option><option value="INACTIVE">{tr('Inactive')}</option><option value="ARCHIVED">{tr('Archive (cannot be undone)')}</option>
                </Select></span>
              </div>
            )}
          </Panel>

          {access && (
            <Panel title={tr('Card and phone pass')} lead={tr('How they come in.')}>
              <ul className="space-y-1.5 text-small">
                <li className="flex justify-between"><span className="text-ink-700"><QrCode aria-hidden="true" className="mr-1.5 inline h-4 w-4" />{tr('Printed card')}</span><span className={cardLive ? 'text-success' : 'text-ink-500'}>{cardLive ? `Issued ${longDate(String(cardLive.issued_at).slice(0, 10))}` : tr('None')}</span></li>
                <li className="flex justify-between"><span className="text-ink-700">{tr('Phone pass')}</span><span className={passLive ? 'text-success' : 'text-ink-500'}>{passLive ? tr('Set up') : tr('Not opened yet')}</span></li>
              </ul>
              {desk && member.status !== 'ARCHIVED' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={issueCard} loading={busy}>{cardLive ? tr('Replace card') : tr('Make a card')}</Button>
                  {(cardLive || passLive) && <Button size="sm" variant="secondary" onClick={cutOff}><ShieldOff aria-hidden="true" className="h-4 w-4" />{tr('Cut off access')}</Button>}
                </div>
              )}
              <p className="mt-3 text-caption text-ink-500">{tr('A printed card is a code anyone holding it can show, like a key. Replace it if it is lost.')}</p>
            </Panel>
          )}

          {hasFeature('gym_rewards') && <MemberRewards memberId={member.member_id} canRedeem={desk} canAdjust={manager} canExclude={manager} excluded={member.rewards_excluded} onChanged={m.reload} />}
          {hasFeature('gym_classes') && <MemberPacks memberId={member.member_id} memberName={member.name} canSell={desk} onChanged={m.reload} />}
          {hasFeature('gym_classes') && (can('gym_trainer') || manager) && <MemberTraining memberId={member.member_id} trainerId={member.assigned_trainer_id} canAssign={manager} onChanged={m.reload} />}
          <Panel title={tr('Family')} lead={member.head ? `Part of ${member.head.name}'s group` : tr('People who share this membership')}>
            {member.head && <p className="text-small"><Link className="text-brand-600 hover:underline" to={`/app/gym/members/${member.head.member_id}`}>{member.head.name}</Link> {tr('pays for this member.')}</p>}
            {member.dependents.length > 0 && (
              <ul className="space-y-1.5">{member.dependents.map((d) => <li key={d.member_id}><Link to={`/app/gym/members/${d.member_id}`} className="flex items-center gap-2 text-small text-brand-600 hover:underline"><Avatar name={d.name} size="sm" />{d.name}<span className="text-caption text-ink-500">{d.member_code}</span></Link></li>)}</ul>
            )}
            {!member.head && (can('gym_members') || manager) && member.status !== 'ARCHIVED' && <Button className="mt-2" size="sm" variant="secondary" onClick={() => setFamily(true)}><UsersRound aria-hidden="true" className="h-4 w-4" />{tr('Add a family member')}</Button>}
          </Panel>
        </div>
      </div>

      {form && <MemberForm member={member} canHealth={member.health_notes !== undefined} onClose={() => setForm(false)} onSaved={() => { setForm(false); toast.success(tr('Saved')); m.reload(); }} />}
      {family && <MemberForm headId={member.member_id} headName={member.name} canHealth={member.health_notes !== undefined} onClose={() => setFamily(false)} onSaved={(d) => { setFamily(false); toast.success(tr('{{d_name}} added', { d_name: d.name })); m.reload(); }} />}
      {sell && <SellDialog mode={sell.mode} member={member} membership={sell.membership} canDiscount={manager} canComplimentary={manager} onClose={() => setSell(null)} onDone={done(sell.mode === 'change' ? 'Plan changed' : 'Membership sold')} />}
      {freeze && <FreezeDialog membership={freeze} onClose={() => setFreeze(null)} onDone={done('Frozen')} />}
      {extend && <ExtendDialog membership={extend} onClose={() => setExtend(null)} onDone={done('Days added')} />}
      {cancel && <CancelDialog membership={cancel} onClose={() => setCancel(null)} onDone={done('Cancelled')} />}
      {transfer && <TransferDialog membership={transfer} member={member} onClose={() => setTransfer(null)} onDone={done('Transferred')} />}
      {history && <HistoryDialog membership={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
