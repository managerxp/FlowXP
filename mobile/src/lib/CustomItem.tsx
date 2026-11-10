import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, ErrorText, Soft, color, s } from './ui.tsx';
import { customPresets, GST_RATES, presetRate, type Preset } from './customItems.ts';
import { toPaise } from './money.ts';
import { t } from './i18n.ts';

/* "Other item": something not on the menu. Tap a usual name or type one, type the price, tap Add. GST is asked only when the shop charges GST. */
export default function CustomItem({ open, businessType, gstOn, onAdd, onClose }: { open: boolean; businessType: string; gstOn: boolean; onAdd: (name: string, pricePaise: number, quantity: number, taxRate: number) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [pick, setPick] = useState<Preset | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState('');
  const presets = customPresets(businessType);
  const paise = toPaise(Number(price) || 0);
  const effective = !gstOn ? 0 : rate ?? (pick ? presetRate(pick.gst, paise) : 0);

  const reset = () => { setName(''); setPrice(''); setQty(1); setPick(null); setRate(null); setError(''); };
  const add = () => {
    if (!(paise > 0)) { setError(t('Type the price.')); return; }
    onAdd(name, paise, qty, effective); reset(); onClose();
  };
  const chip = (on: boolean) => ({ minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' as const, borderRadius: 22, backgroundColor: on ? color.brand : color.card, borderWidth: 1, borderColor: on ? color.brand : color.line });

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={() => { reset(); onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: '90%', backgroundColor: color.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: color.ink }}>{t('Add another item')}</Text>
          <Soft>{t('For something that is not on your menu. Type the price and tap Add.')}</Soft>
          {presets.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
              {presets.map((p) => (
                <Pressable key={p.name} accessibilityRole="button" accessibilityState={{ selected: name === t(p.name) }} onPress={() => { setName(t(p.name)); setPick(p); setRate(null); }} style={chip(name === t(p.name))}>
                  <Text style={{ color: name === t(p.name) ? '#fff' : color.ink, fontWeight: '600' }}>{t(p.name)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <TextInput style={s.input} value={name} onChangeText={(v) => { setName(v); setPick(null); }} placeholder={t('What is it? (you can leave this empty)')} maxLength={80} accessibilityLabel={t('What is it?')} />
          <TextInput style={[s.input, { fontSize: 24, fontWeight: '700' }]} value={price} onChangeText={(v) => { setPrice(v.replace(/[^0-9.]/g, '')); setError(''); }} placeholder="₹ 0" keyboardType="decimal-pad" autoFocus accessibilityLabel={t('Price')} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: color.ink }}>{t('How many')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('One less')} onPress={() => setQty((q) => Math.max(1, q - 1))} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 26, color: color.brand }}>−</Text></Pressable>
              <Text style={{ fontSize: 22, fontWeight: '800', minWidth: 32, textAlign: 'center', color: color.ink }}>{qty}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('One more')} onPress={() => setQty((q) => q + 1)} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 26, color: color.brand }}>+</Text></Pressable>
            </View>
          </View>
          {gstOn ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: '700', color: color.ink }}>{t('GST')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {GST_RATES.map((r) => <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: effective === r }} onPress={() => setRate(r)} style={chip(effective === r)}><Text style={{ color: effective === r ? '#fff' : color.ink, fontWeight: '600' }}>{r}%</Text></Pressable>)}
              </View>
            </View>
          ) : null}
          <ErrorText>{error}</ErrorText>
          <Button title={t('Add to bill')} onPress={add} />
          <Button title="Cancel" kind="quiet" onPress={() => { reset(); onClose(); }} />
        </ScrollView>
      </View>
    </Modal>
  );
}
