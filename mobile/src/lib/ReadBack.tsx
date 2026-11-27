import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { itemName, spoken, type OrderItem } from './orders.ts';
import { qty } from './money.ts';
import { Page } from './responsive.tsx';
import { Button, Soft, Title, color, s } from './ui.tsx';

/* The last look before the kitchen: only what is about to be sent, large enough to read out to the table. Nothing goes until it is confirmed. */
export default function ReadBack({ open, where, items, onSend, onClose }: { open: boolean; where: string; items: OrderItem[]; onSend: () => void; onClose: () => void }) {
  const lines = spoken(items);
  const count = lines.reduce((a, i) => a + Number(i.quantity), 0);
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <Page max={720}>
          <View style={{ padding: 16, gap: 4 }}>
            <Title>{`Read back: ${where}`}</Title>
            <Soft>Read this to the guests. Send it only when they say it is right.</Soft>
          </View>
          <ScrollView style={{ flex: 1 }}>
            {lines.map((i) => (
              <View key={i.order_item_id} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <Text style={{ minWidth: 48, fontSize: 24, fontWeight: '800', color: color.ink }}>{qty(i.quantity)}×</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 22, fontWeight: '600', color: color.ink }}>{itemName(i)}</Text>
                  {i.kitchen_notes ? <Text style={{ fontSize: 16, color: color.warn }}>{i.kitchen_notes}</Text> : null}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={{ padding: 12, gap: 8, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line }}>
            <Text style={{ fontSize: 18, fontWeight: '700', textAlign: 'center', color: color.ink }}>{`${qty(count)} item${count === 1 ? '' : 's'} to send`}</Text>
            <Button title="Confirmed, send to kitchen" onPress={onSend} disabled={!count} />
            <Button title="Change the order" kind="quiet" onPress={onClose} />
          </View>
        </Page>
      </SafeAreaView>
    </Modal>
  );
}
