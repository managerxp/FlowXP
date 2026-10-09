import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Soft, color } from './ui.tsx';
import { t } from './i18n.ts';
import { getRawBT, readMode, setMode, type PrinterMode } from './thermal.ts';
import { printReceipt, type Paper } from './print.ts';

const TEST_RECEIPT = ['FlowXP', 'Test receipt', '-'.repeat(32), '12345678901234567890123456789012', 'Total                     ₹1.00', '-'.repeat(32), 'If this lines up, the printer is set.'].join('\n');

/* How a receipt is printed: the phone's own print screen (any printer it can reach), or straight to a thermal printer through the RawBT app. */
export default function PrinterSettings({ paper }: { paper: Paper }) {
  const [mode, setModeState] = useState<PrinterMode>('system');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void readMode().then(setModeState); }, []);

  const choose = async (m: PrinterMode) => {
    await setMode(m); setModeState(m); setProblem('');
    setNote(m === 'rawbt' ? t('Receipts now go to your thermal printer through RawBT. Print a test receipt to check it.') : t("Printing with the phone's print screen."));
  };
  const test = async () => {
    setProblem(''); setNote(''); setBusy(true);
    try {
      const how = await printReceipt(TEST_RECEIPT, paper);
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
        <Button title={t('Phone print screen')} kind={mode === 'system' ? 'primary' : 'quiet'} onPress={() => { void choose('system'); }} style={{ flex: 1 }} />
        <Button title={t('Thermal printer (RawBT)')} kind={mode === 'rawbt' ? 'primary' : 'quiet'} onPress={() => { void choose('rawbt'); }} style={{ flex: 1 }} />
      </View>
      {mode === 'rawbt' ? <Soft>{t('One time: install the free RawBT app, switch your printer on, and connect it inside RawBT (Bluetooth or USB). After that, FlowXP prints to it with no questions.')}</Soft> : null}
      <Button title={t('Get the RawBT app')} kind="quiet" onPress={() => { void getRawBT(); }} />
      <Button title={t('Print a test receipt')} kind="quiet" onPress={() => { void test(); }} busy={busy} />
      <ErrorText>{problem}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
    </View>
  );
}
