import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api, currentBusiness, loadMe, useSession } from './session.ts';
import { Button, ErrorText, Soft, color, s } from './ui.tsx';
import { t } from './i18n.ts';
import { cleanUpi, upiLabel, upiProblem } from './upi.ts';

/* The UPI ID customers pay to when they scan the QR on the payment screen. Only the owner can change it (the server says so too); everyone else sees it. */
export default function UpiSettings() {
  const session = useSession();
  const business = currentBusiness(session);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  if (!business) return null;
  const current = upiLabel(business.upi_vpa);
  const owner = business.role === 'OWNER';

  const save = async () => {
    const value = cleanUpi(text);
    const bad = upiProblem(value);
    if (bad) { setProblem(t(bad)); return; }
    setBusy(true); setProblem(''); setDone('');
    try {
      await api.call('/businesses/current', { method: 'PATCH', body: { upi_vpa: value || null } });
      await loadMe();
      setEditing(false);
      setDone(value ? t('UPI ID saved. To check it, make a ₹1 bill and pay it with the QR code.') : t('UPI ID removed. The payment screen will not show a QR code.'));
    } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not save the UPI ID.')); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('UPI ID')}</Text>
      <Soft>{current ? t('Customers who scan the QR on the payment screen pay to this UPI ID.') : t('No UPI ID yet. Add one and the payment screen shows a QR code customers can scan.')}</Soft>
      <View style={s.card}><Text selectable style={{ color: current ? color.ink : color.soft, fontSize: 16 }}>{current || t('Not set')}</Text></View>
      {owner && !editing ? <Button title={current ? t('Change UPI ID') : t('Add UPI ID')} kind="quiet" onPress={() => { setText(current); setEditing(true); setDone(''); setProblem(''); }} /> : null}
      {!owner ? <Soft>{t('Only the owner can change the UPI ID.')}</Soft> : null}
      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput style={s.input} value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="shopname@okhdfcbank" accessibilityLabel={t('UPI ID')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('Save')} onPress={() => { void save(); }} busy={busy} style={{ flex: 1 }} />
            <Button title={t('Cancel')} kind="quiet" onPress={() => { setEditing(false); setProblem(''); }} style={{ flex: 1 }} />
          </View>
          <Soft>{t('Leave it empty to remove the UPI ID.')}</Soft>
        </View>
      ) : null}
      <ErrorText>{problem}</ErrorText>
      {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{done}</Text> : null}
    </View>
  );
}
