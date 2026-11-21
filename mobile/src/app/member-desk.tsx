import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { ApiError } from '../lib/api.ts';
import { allowed, hasFeature } from '../lib/access.ts';
import { t, fill } from '../lib/i18n.ts';
import { Card, Input, Msg, Panel, SetupShell, useAct } from '../lib/formKit.tsx';
import { rupees } from '../lib/money.ts';
import { Button, Chips, ErrorText, Line, Loading, SectionTitle, Soft, color, Group } from '../lib/ui.tsx';
import { display } from '../lib/theme.ts';
import { canUndo, lookupQuery, needsAmount, newKey, paint, perBill, valueLine, type Found, type Member, type Programme, type Reward } from '../lib/memberDesk.ts';

/* The card as the customer sees it: its own colours, one circle per stamp (or the points). */
const CardFace = ({ m }: { m: Member }) => {
  const c = paint(m.card);
  const stamps = perBill(m.kind);
  const total = Math.min(Math.max(m.redeem_points || 1, 1), 12);
  const filled = Math.min(m.balance, total);
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 16, padding: 16, gap: 10 }}>
      <Text style={{ color: c.fg, fontSize: 18, fontWeight: '700' }}>{c.title || m.programme_name}</Text>
      {stamps ? (
        <View accessibilityLabel={`${filled} / ${total}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: i < filled ? c.accent : `${c.fg}88`, backgroundColor: i < filled ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: i < filled ? c.bg : `${c.fg}aa`, fontWeight: '700', fontSize: 12 }}>{i < filled ? '✓' : String(i + 1)}</Text>
            </View>
          ))}
        </View>
      ) : <Text style={{ color: c.fg, fontSize: 36, fontFamily: display.bold, fontVariant: ['tabular-nums'] }}>{m.balance}<Text style={{ fontSize: 14 }}>{` ${t('Points')}`}</Text></Text>}
      {c.message ? <Text style={{ color: c.fg, opacity: 0.9 }}>{c.message}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: c.fg, opacity: 0.8, fontSize: 12 }}>{m.customer_name}</Text><Text style={{ color: c.fg, opacity: 0.8, fontSize: 12 }}>{m.membership_no}</Text></View>
    </View>
  );
};

const MemberPanel = ({ id }: { id: number }) => {
  const me = currentBusiness(useSession());
  const [m, setM] = useState<Member | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('');
  const [points, setPoints] = useState('');
  const keys = useRef<Record<string, string>>({});   // one key per kind of action, kept until it works, so a retry is the same request
  const a = useAct();
  const load = async () => {
    try { const [x, r] = await Promise.all([api.get<Member>(`/loyalty/members/${id}`), api.get<Reward[]>(`/loyalty/members/${id}/rewards`)]); setM(x); setRewards(r); setLoadError(''); }
    catch (e) { setLoadError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;
  const stamps = perBill(m.kind);
  const act = (name: string, path: string, body: object, done: (o: any) => string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    keys.current[name] ||= newKey();
    void a.run('', async () => {
      const out = await api.post<any>(path, { ...body, key: keys.current[name] }); // eslint-disable-line @typescript-eslint/no-explicit-any
      delete keys.current[name];
      a.setNote(done(out));
      await load();
    }, '');
  };
  const off = m.status !== 'ACTIVE';
  const askAmount = needsAmount(m);
  const paise = Math.round(Number(amount || 0) * 100);
  return (
    <>
      <CardFace m={m} />
      {m.standing?.tier ? <Soft>{fill(t('{tier} member, earns {x}x points'), { tier: m.standing.tier.name, x: String(m.standing.tier.multiplier) }) + (m.standing.next ? ` · ${fill(t('{n} more points to reach {tier}'), { n: String(m.standing.next.points_to_go), tier: m.standing.next.name })}` : '')}</Soft> : null}
      <Soft>{`${m.customer_phone ?? ''}${off ? ` · ${t('Switched off')}` : ''}`}</Soft>
      <Msg a={a} />
      <Card>
        <SectionTitle>{stamps ? 'Stamp' : 'Add points'}</SectionTitle>
        {askAmount ? <Input label="Bill amount" numeric value={amount} onChange={(v) => { setAmount(v); delete keys.current.earn; }} /> : null}
        <Button title={stamps ? 'Stamp' : 'Add points'} busy={a.busy} disabled={off || (askAmount && !(paise > 0))}
          onPress={() => act('earn', `/loyalty/members/${id}/earn`, { amount_paise: paise }, (o) => (o.points ? fill(t('Added. Balance {b}'), { b: o.balance }) : t('This bill is too small to earn anything')))} />
        <Soft>{t('Bills made with the customer\'s mobile number add automatically. Use this for a bill made without it.')}</Soft>
      </Card>
      <Card>
        <SectionTitle>Rewards</SectionTitle>
        {rewards.map((r) => (
          <View key={r.reward_id} style={{ gap: 6 }}>
            <Line left={r.name} right={valueLine(r.value_paise)} sub={`${r.points_cost} ${t(stamps ? 'Stamps' : 'Points')}${!r.affordable && r.points_short > 0 ? ` · ${fill(t('{n} more needed'), { n: r.points_short })}` : ''}`} />
            <Button title="Give" kind={r.affordable ? 'primary' : 'quiet'} busy={a.busy} disabled={!r.affordable || off}
              onPress={() => act(`claim${r.reward_id}`, `/loyalty/members/${id}/claim`, { reward_id: r.reward_id }, (o) => {
                const v = valueLine(o.redemption.value_paise);
                return v ? fill(t('Take {value} off the bill. Balance {b}'), { value: v, b: o.balance }) : fill(t('{name} given. Balance {b}'), { name: r.name, b: o.balance });
              })} />
          </View>
        ))}
        {!rewards.length ? <Soft>{t('No rewards on this card yet.')}</Soft> : null}
        {!stamps ? (
          <>
            <Input label="Use points" numeric value={points} onChange={(v) => { setPoints(v); delete keys.current.redeem; }} hint={`${m.min_redeem_points}+`} />
            <Button title="Use points" kind="quiet" busy={a.busy} disabled={off || !(Number(points) > 0)}
              onPress={() => act('redeem', `/loyalty/members/${id}/redeem`, { points: Number(points) }, (o) => fill(t('Take {value} off the bill. Balance {b}'), { value: rupees(Number(o.value_paise)), b: o.balance }))} />
          </>
        ) : null}
      </Card>
      <Card>
        <SectionTitle>Recent</SectionTitle>
        {m.ledger.slice(0, 8).map((e) => (
          <View key={e.entry_id} style={{ gap: 4 }}>
            <Line left={e.note || e.kind} right={`${e.points > 0 ? '+' : ''}${e.points}`} sub={new Date(e.created_at).toLocaleDateString()} />
            {canUndo(e, me?.role) ? (
              <Button title="Undo" kind="quiet" busy={a.busy}
                onPress={() => (e.claim_id ? act(`undo${e.entry_id}`, `/loyalty/claims/${e.claim_id}/cancel`, {}, () => t('Reward taken back, points returned')) : act(`undo${e.entry_id}`, `/loyalty/ledger/${e.entry_id}/reverse`, { reason: 'Undone at the member desk' }, () => t('Undone')))} />
            ) : null}
          </View>
        ))}
        {!m.ledger.length ? <Soft>{t('Nothing yet.')}</Soft> : null}
      </Card>
    </>
  );
};

const JoinForm = ({ phone, onJoined }: { phone: string; onJoined: (id: number) => void }) => {
  const [list, setList] = useState<Programme[] | null>(null);
  const [pid, setPid] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState(phone.length >= 10 ? phone : '');
  const [consent, setConsent] = useState(false);
  const a = useAct();
  useEffect(() => { api.get<Programme[]>('/loyalty/programmes').then((r) => { const on = r.filter((x) => x.is_active); setList(on); if (on[0]) setPid(String(on[0].programme_id)); }).catch(() => setList([])); }, []);
  if (list && !list.length) return <Soft>{t('There is no loyalty card yet. The owner can make one under Loyalty & coupons.')}</Soft>;
  return (
    <Card>
      <SectionTitle>Not a member yet. Join them now</SectionTitle>
      <Input label="Customer name" value={name} onChange={setName} max={80} />
      <Input label="Mobile number" numeric value={mobile} onChange={setMobile} max={10} />
      {list && list.length > 1 ? <Chips items={list.map((p) => ({ id: String(p.programme_id), label: p.name }))} value={pid} onChange={setPid} /> : null}
      <Chips items={[{ id: 'no', label: 'No offers' }, { id: 'yes', label: 'They agreed to receive offers' }]} value={consent ? 'yes' : 'no'} onChange={(v) => setConsent(v === 'yes')} />
      <Msg a={a} />
      <Button title="Join" busy={a.busy} disabled={!name.trim() || mobile.length < 10 || !pid}
        onPress={() => { void a.run('', async () => { const out = await api.post<{ membership: { membership_id: number } }>('/loyalty/members', { programme_id: Number(pid), name, phone: mobile, consent_marketing: consent }); onJoined(out.membership.membership_id); }, 'Saved'); }} />
    </Card>
  );
};

/* The till's loyalty screen: find a member (mobile number, member number, or the card's QR), then stamp, give a reward, or join a new customer. */
export default function MemberDesk() {
  const me = currentBusiness(useSession());
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [none, setNone] = useState(false);
  const [error, setError] = useState('');
  const [scan, setScan] = useState(false);
  const [permission, ask] = useCameraPermissions();
  const scanned = useRef(false);
  const search = async (raw: string) => {
    setError(''); setNone(false); setPicked(null); setFound(null);
    if (!raw.trim()) return;
    try {
      const rows = await api.get<Found[]>(`/loyalty/members/lookup?${lookupQuery(raw)}`);
      setFound(rows); if (rows.length === 1) setPicked(rows[0].membership_id);
    } catch (e) { if (e instanceof ApiError && e.status === 404) setNone(true); else setError((e as Error).message); }
  };
  const ok = allowed(me, 'billing') && hasFeature(me, 'loyalty_programmes');
  return (
    <SetupShell title="Member desk" sub="Find a member, add a stamp or points, or give a reward." ok={ok} denied="You do not have access to the member desk.">
      <Panel>
        <Input label="Find" value={q} onChange={setQ} placeholder="Mobile number, member number or scan" />
        <Button title="Find" onPress={() => { void search(q); }} />
        {scan ? (
          !permission ? <Loading /> : !permission.granted ? (
            <Button title="Allow the camera" onPress={() => { void ask(); }} />
          ) : (
            <View style={{ gap: 8 }}>
              <CameraView style={{ height: 280, borderRadius: 12 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => { if (scanned.current) return; scanned.current = true; setScan(false); setQ(data); void search(data); }} />
              <Soft>{t('Point the camera at the card QR')}</Soft>
              <Button title="Close camera" kind="quiet" onPress={() => setScan(false)} />
            </View>
          )
        ) : <Button title="Scan a card" kind="quiet" onPress={() => { scanned.current = false; setScan(true); }} />}
        <ErrorText>{error}</ErrorText>
        <Group>{found && found.length > 1 && picked === null ? found.map((r) => <Line key={r.membership_id} left={r.customer_name} right={String(r.balance)} sub={r.programme_name} onPress={() => setPicked(r.membership_id)} />) : null}</Group>
        {picked !== null ? <MemberPanel key={picked} id={picked} /> : null}
        {none ? (
          <>
            <Soft>{t('No membership found.')}</Soft>
            <JoinForm phone={lookupQuery(q).startsWith('phone=') ? q.replace(/\D/g, '').slice(-10) : ''} onJoined={(id) => { setNone(false); setPicked(id); }} />
          </>
        ) : null}
      </Panel>
    </SetupShell>
  );
}
