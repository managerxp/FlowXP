import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { creditLine, debitLine, type CreditNote, type DebitNote } from '../lib/notes.ts';
import { Button, Chips, Empty, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* Credit notes (goods customers brought back) and debit notes (goods sent back to a supplier, or a price correction). */
export default function Notes() {
  const me = currentBusiness(useSession());
  const ok = allowed(me, 'purchases') || allowed(me, 'refunds');
  const [tab, setTab] = useState<'credit' | 'debit'>('credit');
  const [credit, setCredit] = useState<CreditNote[] | null>(null);
  const [debit, setDebit] = useState<DebitNote[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { if (tab === 'credit') setCredit(await api.get<CreditNote[]>('/credit-notes')); else setDebit(await api.get<DebitNote[]>('/debit-notes')); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, [tab]);
  useFocusEffect(useCallback(() => { if (ok) void load(); }, [load, ok]));
  const rows = tab === 'credit' ? credit : debit;

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Credit and debit notes</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to notes.</Empty> : (
          <>
            <Chips items={[{ id: 'credit', label: 'Credit notes' }, { id: 'debit', label: 'Debit notes' }]} value={tab} onChange={setTab} />
            {error && !rows ? <Failed message={error} onRetry={() => { void load(); }} /> : !rows ? <Loading /> : (
              <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
                <Soft style={{ padding: 16 }}>{t('Credit notes are for goods customers brought back. Debit notes are for goods sent back to a supplier, or a price correction.')}</Soft>
                {rows.length === 0 ? <Empty>{tab === 'credit' ? 'No credit notes yet.' : 'No debit notes yet.'}</Empty> : null}
                {tab === 'credit' ? credit?.map((c) => <Line key={c.cn_id} left={c.cn_number} right={money(c.total)} sub={creditLine(c)} onPress={() => router.push({ pathname: '/note', params: { type: 'credit', id: String(c.cn_id) } })} />)
                  : debit?.map((d) => <Line key={d.dn_id} left={d.dn_number} right={money(d.total)} sub={debitLine(d)} onPress={() => router.push({ pathname: '/note', params: { type: 'debit', id: String(d.dn_id) } })} />)}
              </ScrollView>
            )}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
