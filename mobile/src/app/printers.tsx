import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { kvSet } from '../lib/local.ts';
import { Page } from '../lib/responsive.tsx';
import { COLUMNS, escposBytes } from '../lib/escpos.ts';
import { readMode, setMode, type PrinterMode } from '../lib/thermal.ts';
import { readPrinters, savePrinters, pairedPrinters, printingAvailable, scanPrinters, sendToPrinter, type Found } from '../lib/printerLink.ts';
import {
  DEFAULT_PORT, JOBS, MAX_PRINTERS, hostProblem, nameOf, newId, portProblem, printerLine, removePrinter, setJob, setPaper, upsertPrinter, type SavedPrinter
} from '../lib/printerSetup.ts';
import { Button, Chips, ErrorText, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const testText = (p: SavedPrinter) => { const w = COLUMNS[p.paper]; return ['FlowXP', p.name, 'Test receipt', '-'.repeat(w), '1234567890'.repeat(5).slice(0, w), 'Total'.padEnd(w - 7) + 'Rs.1.00', '-'.repeat(w), 'If this lines up, the printer is set.'].join('\n'); };

/* The printers connected to this phone: a Bluetooth or Wi-Fi thermal printer, its paper, and what it prints (the receipt, the kitchen ticket). */
export default function Printers() {
  const [list, setList] = useState<SavedPrinter[] | null>(null);
  const [mode, setModeState] = useState<PrinterMode>('system');
  const [available, setAvailable] = useState(true);
  const [paired, setPaired] = useState<Found[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { void readPrinters().then(setList); void readMode().then(setModeState); void printingAvailable().then(setAvailable); }, []);
  const commit = useCallback((next: SavedPrinter[]) => {
    setList(next); void savePrinters(next);
    const receipt = next.find((p) => p.jobs.includes('receipt'));
    if (receipt) void kvSet('paper', receipt.paper).catch(() => {});   // the bill is laid out for the paper of the printer that prints it
  }, []);

  const chooseMode = async (m: PrinterMode) => { await setMode(m); setModeState(m); setError(''); };
  const add = (p: Omit<SavedPrinter, 'id' | 'jobs' | 'paper'>) => {
    if ((list?.length ?? 0) >= MAX_PRINTERS && !list?.some((x) => x.address.toLowerCase() === p.address.toLowerCase())) { setError(t('You can keep up to {n} printers.', { n: MAX_PRINTERS })); return; }
    commit(upsertPrinter(list ?? [], { ...p, id: newId(), paper: '58', jobs: [] }));
    setError(''); setNote(t('Saved'));
    if (mode !== 'direct') void chooseMode('direct');
  };
  const loadPaired = async () => { setError(''); setNote(''); try { setPaired(await pairedPrinters()); } catch (e) { setError(t(e instanceof Error ? e.message : 'Could not print.')); } };
  const look = async () => { setError(''); setNote(''); setLooking(true); try { const found = await scanPrinters(); setPaired((cur) => [...(cur ?? []), ...found.filter((f) => !(cur ?? []).some((c) => c.address === f.address))]); } catch (e) { setError(t(e instanceof Error ? e.message : 'Could not print.')); } finally { setLooking(false); } };
  const addNetwork = () => {
    const problem = hostProblem(host) || portProblem(port);
    if (problem) { setError(t(problem)); return; }
    add({ name: nameOf(label, host.trim()), kind: 'network', address: host.trim(), port: Number(port) });
    setHost(''); setLabel('');
  };
  const test = async (p: SavedPrinter) => {
    setError(''); setNote(''); setBusy(p.id);
    try { await sendToPrinter(p, escposBytes(testText(p), p.paper, { extraLines: 3 })); setNote(t('Test sent. If nothing printed, check the printer is on, in range, and has paper.')); }
    catch (e) { setError(t(e instanceof Error ? e.message : 'Could not print.')); } finally { setBusy(''); }
  };
  const remove = (p: SavedPrinter) => Alert.alert(t('Remove “{name}”?', { name: p.name }), '', [{ text: t('Cancel'), style: 'cancel' }, { text: t('Remove'), style: 'destructive', onPress: () => commit(removePrinter(list ?? [], p.id)) }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Printers</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!list ? <Loading /> : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Soft>{t('Connect a Bluetooth or Wi-Fi thermal printer, and choose what each one prints.')}</Soft>
            {!available ? <Soft>{t('Printing straight to a printer needs the FlowXP development app. In the Expo Go test copy, use the phone print screen or RawBT in Settings.')}</Soft> : null}
            <Chips items={[{ id: 'direct', label: 'Straight to my printers' }, { id: 'system', label: 'Phone print screen' }, { id: 'rawbt', label: 'Through RawBT' }]} value={mode} onChange={(m: PrinterMode) => { void chooseMode(m); }} />
            {mode === 'direct' ? <Soft>{t('Receipts go straight to a connected printer. If it cannot be reached, the bill goes to the phone print screen so printing is never stuck.')}</Soft> : null}

            {list.length === 0 ? <Soft>{t('No printers yet.')}</Soft> : null}
            {list.map((p) => (
              <View key={p.id} style={[s.card, { gap: 8 }]}>
                <Line left={p.name} sub={printerLine(p)} icon={p.kind === 'bluetooth' ? 'bluetooth-outline' : 'wifi-outline'} />
                <Text style={{ color: color.soft, fontSize: 13 }}>{t('Paper')}</Text>
                <Chips items={[{ id: '58', label: '58 mm paper' }, { id: '80', label: '80 mm paper' }]} value={p.paper} onChange={(paper) => commit(setPaper(list, p.id, paper))} />
                <Text style={{ color: color.soft, fontSize: 13 }}>{t('What it prints')}</Text>
                {JOBS.map((j) => (
                  <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(j.label)}</Text><Soft>{t(j.hint)}</Soft></View>
                    <Switch value={p.jobs.includes(j.id)} onValueChange={(on) => commit(setJob(list, p.id, j.id, on))} accessibilityLabel={t(j.label)} />
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Button title="Print a test" kind="quiet" onPress={() => { void test(p); }} busy={busy === p.id} /></View>
                  <View style={{ flex: 1 }}><Button title="Remove" kind="danger" onPress={() => remove(p)} /></View>
                </View>
              </View>
            ))}
            <ErrorText>{error}</ErrorText>
            {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}

            <SectionTitle>Add a Bluetooth printer</SectionTitle>
            <Soft>{t("Pair the printer first in the phone's Bluetooth settings (the code is usually 0000 or 1234), then come back and pick it here.")}</Soft>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="Paired Bluetooth printers" kind="quiet" onPress={() => { void loadPaired(); }} /></View>
              <View style={{ flex: 1 }}><Button title={looking ? 'Looking…' : 'Look for printers nearby'} kind="quiet" onPress={() => { void look(); }} busy={looking} /></View>
            </View>
            {paired && paired.length === 0 ? <Soft>{t("No Bluetooth printers found. Switch the printer on and pair it in the phone's Bluetooth settings.")}</Soft> : null}
            {paired?.map((d) => <Line key={d.address} left={d.name} sub={d.address} icon="bluetooth-outline" onPress={() => add({ name: nameOf(d.name, d.address), kind: 'bluetooth', address: d.address, port: DEFAULT_PORT })} />)}

            <SectionTitle>Add a Wi-Fi printer</SectionTitle>
            <TextInput style={s.input} value={label} onChangeText={setLabel} placeholder={t('Printer name')} maxLength={40} accessibilityLabel={t('Printer name')} />
            <TextInput style={s.input} value={host} onChangeText={setHost} placeholder="192.168.1.50" autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" accessibilityLabel={t('Address on the network')} />
            <TextInput style={s.input} value={port} onChangeText={(v) => setPort(v.replace(/\D/g, ''))} keyboardType="numeric" maxLength={5} accessibilityLabel={t('Port')} />
            <Button title="Add this printer" onPress={addNetwork} />
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
