import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, ErrorText, Soft, color } from './ui.tsx';
import { t } from './i18n.ts';
import { getRawBT, readMode, readPrefs, savePrefs, setMode, DEFAULT_PREFS, type PrinterMode, type PrinterPrefs } from './thermal.ts';
import { COLUMNS } from './escpos.ts';
import { printReceipt, type Paper } from './print.ts';

const testReceipt = (paper: Paper) => { const w = COLUMNS[paper]; return ['FlowXP', 'Test receipt', '-'.repeat(w), '1234567890'.repeat(5).slice(0, w), 'Total'.padEnd(w - 7) + 'Rs.1.00', '-'.repeat(w), 'If this lines up, the printer is set.'].join(String.fromCharCode(10)); };

/* How a receipt is printed: the phone's own print screen (any printer it can reach), or straight to a thermal printer through the RawBT app. */
export default function PrinterSettings({ paper }: { paper: Paper }) {
  const [mode, setModeState] = useState<PrinterMode>('system');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<PrinterPrefs>(DEFAULT_PREFS);

  useEffect(() => { void readMode().then(setModeState); void readPrefs().then(setPrefs); }, []);
  const change = (patch: Partial<PrinterPrefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); void savePrefs(next); };

  const choose = async (m: PrinterMode) => {
    await setMode(m); setModeState(m); setProblem('');
    setNote(m === 'rawbt' ? t('Receipts now go to your thermal printer through RawBT. Print a test receipt to check it.') : t("Printing with the phone's print screen."));
  };
  const test = async () => {
    setProblem(''); setNote(''); setBusy(true);
    try {
      const how = await printReceipt(testReceipt(paper), paper);
      if (how === 'fallback') setProblem(t("Could not use the thermal printer (is RawBT installed?), so the test went to the phone's print screen."));
      else if (how === 'printer') setNote(t('Sent to RawBT. If nothing prints, open RawBT and check that your printer is connected there.'));
    } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not print.')); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Receipt printer')}</Text>
      <Soft>{mode === 'rawbt'
        ? t('Printing straight to your thermal printer through the RawBT app.')
        : t("Printing with the phone's print screen: it works with any printer the phone can reach (Wi-Fi, USB, or Bluetooth through the printer maker's app).")}</Soft>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('Phone print screen')} selected={mode === 'system'} onPress={() => { void choose('system'); }} style={{ flex: 1 }} />
        <Button title={t('Thermal printer (RawBT)')} selected={mode === 'rawbt'} onPress={() => { void choose('rawbt'); }} style={{ flex: 1 }} />
      </View>
      {mode === 'rawbt' ? <Soft>{t('One time: install the free RawBT app, switch your printer on, and connect it inside RawBT (Bluetooth or USB). After that, FlowXP prints to it with no questions.')}</Soft> : null}
      {mode !== 'system' ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t('Cut the paper after each receipt')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('Cut')} selected={prefs.cut} onPress={() => change({ cut: true })} style={{ flex: 1 }} />
            <Button title={t('Do not cut')} selected={!prefs.cut} onPress={() => change({ cut: false })} style={{ flex: 1 }} />
          </View>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t('Copies of each receipt')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 2, 3].map((n) => <Button key={n} title={String(n)} selected={prefs.copies === n} onPress={() => change({ copies: n })} style={{ flex: 1 }} />)}
          </View>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t('Blank lines after the receipt')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 3, 5, 8].map((n) => <Button key={n} title={String(n)} selected={prefs.extraLines === n} onPress={() => change({ extraLines: n })} style={{ flex: 1 }} />)}
          </View>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t('Open the cash drawer with each receipt')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('Off')} selected={!prefs.drawer} onPress={() => change({ drawer: false })} style={{ flex: 1 }} />
            <Button title={t('On')} selected={prefs.drawer} onPress={() => change({ drawer: true })} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
      <Button title={t('Printers')} kind="quiet" onPress={() => router.push('/printers')} />
      <Button title={t('Get the RawBT app')} kind="quiet" onPress={() => { void getRawBT(); }} />
      <Button title={t('Print a test receipt')} kind="quiet" onPress={() => { void test(); }} busy={busy} />
      <ErrorText>{problem}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
    </View>
  );
}
