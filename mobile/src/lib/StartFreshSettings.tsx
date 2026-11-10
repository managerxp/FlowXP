import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, ErrorText, Soft, color, s } from './ui.tsx';
import { api } from './session.ts';
import { t } from './i18n.ts';

/* Settings > Start fresh (owner only, shown only on the free trial before a first paid plan): clears the practice bills, orders, purchases, expenses and stock history, numbering restarts at 1. The server checks all of it again. */
export default function StartFreshSettings() {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { api.get<{ allowed: boolean }>('/businesses/current/start-fresh').then((d) => setAllowed(!!d.allowed)).catch(() => {}); }, []);
  if (!allowed) return null;

  const run = async () => {
    setBusy(true); setError('');
    try { await api.post('/businesses/current/start-fresh', { confirm: word }); setDone(t('Your trial data is cleared. Numbering starts again from 1.')); setOpen(false); setWord(''); setAllowed(true); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not clear the data.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Start fresh')}</Text>
      <Soft>{t('Done trying FlowXP? Clear the practice bills and stock history and begin real work from bill number 1. Only possible during the free trial.')}</Soft>
      {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{done}</Text> : null}
      {open ? (
        <>
          <Soft>{t('This deletes every bill, order, payment, purchase, expense and stock movement made so far, and cannot be undone. Products, customers, staff and settings stay. Stock goes back to 0 so you can count it again.')}</Soft>
          <TextInput style={s.input} value={word} onChangeText={setWord} placeholder={t('Type START FRESH to confirm')} autoCapitalize="characters" autoCorrect={false} accessibilityLabel={t('Type START FRESH to confirm')} />
          <ErrorText>{error}</ErrorText>
          <Button title={t('Delete and start fresh')} kind="danger" onPress={() => { void run(); }} busy={busy} disabled={!word.trim()} />
          <Button title="Cancel" kind="quiet" onPress={() => { setOpen(false); setWord(''); setError(''); }} />
        </>
      ) : <Button title="Start fresh" kind="quiet" onPress={() => { setOpen(true); setDone(''); }} />}
    </View>
  );
}
