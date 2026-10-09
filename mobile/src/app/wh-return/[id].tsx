import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { DISPOSITION_LABEL, REASON_LABEL, type ReturnDetail } from '../../lib/returns.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

/* One return: what came back (or went back), why, the credit or debit note it made, and where each item went. */
export default function ReturnDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useLoad<ReturnDetail>(`wh-return:${id}`, () => api.get<ReturnDetail>(`/wholesale/returns/${id}`));
  const x = r.data;
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{x?.return_number ?? 'Return'}</Title>{x ? <Soft>{`${x.customer ?? x.supplier ?? ''} · ${String(x.created_at).slice(0, 10)}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {r.busy && !x ? <Loading /> : null}
        {r.error && !x ? <Failed message={r.error} onRetry={() => { void r.refresh(); }} /> : null}
        {x ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16, gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{x.kind === 'SALE' ? 'Goods a shop sent back' : 'Goods sent back to a supplier'}</Text>
              <Soft>{`Why: ${REASON_LABEL[x.reason]}${x.notes ? ` · ${x.notes}` : ''}`}</Soft>
              {x.kind === 'SALE' ? <Soft>{`Bill ${x.invoice_number ?? ''} · credit note ${x.cn_number ?? ''}${x.cn_total != null ? ` · ${rupees(toPaise(x.cn_total))}` : ''}`}</Soft> : <Soft>{`Order ${x.po_number ?? ''} · debit note ${x.dn_number ?? ''}${x.dn_total != null ? ` · ${rupees(toPaise(x.dn_total))}` : ''}`}</Soft>}
            </View>
            <SectionTitle>Items</SectionTitle>
            {x.items.map((i, k) => <Line key={k} left={i.product} sub={`${x.kind === 'SALE' ? DISPOSITION_LABEL[i.disposition] : 'Sent back'}${i.batch_no ? ` · batch ${i.batch_no}` : ''}`} right={`${qty(i.quantity)} ${i.unit_name ?? ''}`} />)}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
