import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { day, debitEffect, debitKind, itemLine, type CreditNote, type DebitNote } from '../lib/notes.ts';
import { Button, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* One credit note or debit note: what it was for, its lines, the totals, and what it did to the balance. */
export default function Note() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const debit = type === 'debit';
  const [note, setNote] = useState<(CreditNote & DebitNote) | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get<CreditNote & DebitNote>(debit ? `/debit-notes/${id}` : `/credit-notes/${id}`).then(setNote).catch((e: Error) => setError(e.message || t('Could not load.'))); }, [debit, id]);
  if (error && !note) return <SafeAreaView style={s.screen}><Failed message={error} /></SafeAreaView>;
  if (!note) return <SafeAreaView style={s.screen}><Loading /></SafeAreaView>;
  const items = (note.items ?? []) as { description: string; quantity: number; tax_rate: number; total: number }[];
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Title>{debit ? note.dn_number : note.cn_number}</Title>
            <Soft>{debit ? `${debitKind(note.kind)} · ${t('Order {number}', { number: note.po_number })} · ${day(note.dn_date)}${note.supplier_name ? ` · ${note.supplier_name}` : ''}` : `${t('Bill {number}', { number: note.invoice_number })} · ${day(note.date)}${note.customer_name ? ` · ${note.customer_name}` : ''}`}</Soft>
          </View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {note.reason ? <View style={[s.card, { marginHorizontal: 16 }]}><Text style={{ color: color.ink }}>{note.reason}</Text></View> : null}
          <SectionTitle>Items</SectionTitle>
          {items.map((i, k) => <Line key={k} left={i.description} sub={itemLine(i)} right={money(i.total)} />)}
          <View style={{ padding: 16, gap: 4, alignItems: 'flex-end' }}>
            <Soft>{`${t('Subtotal')} ${money(note.subtotal)} · ${t('Tax')} ${money(note.tax)}`}</Soft>
            <Text style={{ fontSize: 18, fontWeight: '800', color: color.ink }}>{`${t('Total')} ${money(note.total)}`}</Text>
            {debit ? <Soft>{debitEffect(note)}</Soft> : null}
          </View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
