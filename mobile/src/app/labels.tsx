import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { pname, type Product } from '../lib/catalog.ts';
import { clampCopies, codeOf, labelsHtml, totalLabels, type LabelLine, type LabelSize } from '../lib/labels.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Print labels: search a product, say how many labels, print them (or save as a PDF to share). The barcode is the product's own, or its SKU. */
export default function Labels() {
  const scope = useScope();
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<LabelLine[]>([]);
  const [size, setSize] = useState<LabelSize>('sheet');
  const [showMrp, setShowMrp] = useState(true);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const n = totalLabels(lines);

  useEffect(() => {
    let live = true;
    if (!scope || !text.trim()) { setFound([]); return; }
    void scope.catalog.search(text).then((r) => { if (live) setFound(r); });
    return () => { live = false; };
  }, [scope, text]);

  const add = (p: Product) => {
    setText(''); setFound([]); setProblem(''); setNote('');
    setLines((ls) => (ls.some((l) => l.product.product_id === p.product_id) ? ls : [...ls, { product: p, copies: 1 }]));
  };
  const setCopies = (id: number, v: string) => setLines((ls) => ls.map((l) => (l.product.product_id === id ? { ...l, copies: clampCopies(Number(v.replace(/\D/g, ''))) } : l)));

  const run = async (how: 'print' | 'pdf') => {
    setBusy(how); setProblem(''); setNote('');
    try {
      const page = labelsHtml(lines, size, showMrp);
      const Print = await import('expo-print');
      if (how === 'print') await Print.printAsync({ html: page.html, width: page.width });
      else {
        const Sharing = await import('expo-sharing');
        if (!(await Sharing.isAvailableAsync())) throw new Error(t('This phone cannot share files from FlowXP.'));
        const { uri } = await Print.printToFileAsync({ html: page.html, width: page.width });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('Share the labels'), UTI: 'com.adobe.pdf' });
      }
    } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not print the labels.')); }
    finally { setBusy(''); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{t('Print labels')}</Title><Soft>{t('Price tags with a barcode, for the shelf or the pack.')}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search for an item" accessibilityLabel="Search for an item" autoCorrect={false} />
            {found.map((p) => <Line key={p.product_id} left={pname(p)} sub={codeOf(p) || t('No barcode or item code yet')} onPress={() => add(p)} />)}
          </View>
          {lines.map((l) => (
            <View key={l.product.product_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
              <Text style={{ fontSize: 16, color: color.ink }}>{pname(l.product)}</Text>
              {codeOf(l.product) ? <Soft>{codeOf(l.product)}</Soft> : <Text style={{ color: color.warn }}>{t('No barcode or item code yet. Add one on the product to print its label.')}</Text>}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ color: color.ink }}>{t('How many labels')}</Text>
                <TextInput style={[s.input, { width: 90 }]} value={String(l.copies)} onChangeText={(v) => setCopies(l.product.product_id, v)} keyboardType="number-pad" accessibilityLabel={`${t('How many labels')} ${l.product.name}`} />
                <Button title="Remove" kind="quiet" onPress={() => setLines((ls) => ls.filter((x) => x.product.product_id !== l.product.product_id))} />
              </View>
            </View>
          ))}
          {lines.length ? (
            <View style={{ padding: 16, gap: 10 }}>
              <SectionTitle>{t('Label size')}</SectionTitle>
              <Chips items={[{ id: 'sheet', label: 'A4 sheet (3 across)' }, { id: 'roll', label: 'Label roll 50 × 25 mm' }]} value={size} onChange={setSize} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <Text style={{ color: color.ink }}>{t('Show the MRP')}</Text><Switch value={showMrp} onValueChange={setShowMrp} />
              </View>
              <ErrorText>{problem}</ErrorText>
              {note ? <Text style={{ color: color.ok }}>{note}</Text> : null}
              <Button title={t('Print {n} labels', { n })} onPress={() => { void run('print'); }} busy={busy === 'print'} disabled={n === 0} />
              <Button title={t('Save as PDF and share')} kind="quiet" onPress={() => { void run('pdf'); }} busy={busy === 'pdf'} disabled={n === 0} />
            </View>
          ) : <Soft style={{ padding: 16 }}>{t('Search for an item above to make labels for it.')}</Soft>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
