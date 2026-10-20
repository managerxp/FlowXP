import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { DETAIL_FIELDS, type TaxInvoice } from '../lib/taxInvoice.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, ErrorText, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

/* The consignee, delivery, dispatch and payment-terms details printed on this bill's GST tax invoice (the website's "Edit invoice details").
   Blank buyer fields fall back to the customer's record; a blank consignee means the same as the buyer. Saved on the bill, so a reprint matches. */
export default function InvoiceDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<TaxInvoice>(`/invoices/${id}`).then((inv) => {
      const x = inv.print_extra ?? {};
      setNumber(inv.invoice_number);
      setValues({ ...Object.fromEntries(DETAIL_FIELDS.map(([k]) => [k, x[k] ?? ''])), buyer_address: x.buyer_address ?? inv.customer_address ?? '', buyer_state: x.buyer_state ?? inv.customer_state ?? '', buyer_email: x.buyer_email ?? inv.customer_email ?? '' });
    }).catch((e: Error) => setError(e.message));
  }, [id]);

  const save = async () => {
    if (!values) return;
    setBusy(true); setError('');
    try { await api.call(`/invoices/${id}/print-details`, { method: 'PATCH', body: values }); router.back(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={560}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{t('Invoice details')}{number ? ` · ${number}` : ''}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          <Soft>{t('Printed on this tax invoice only. Leave the consignee blank when it is the same as the buyer.')}</Soft>
          {!values && !error ? <Loading /> : null}
          {values ? DETAIL_FIELDS.map(([k, label, big]) => (
            <View key={k} style={{ gap: 4 }}>
              <Text style={{ color: color.soft, fontSize: 13 }}>{label}</Text>
              <TextInput style={[s.input, big ? { minHeight: 64, textAlignVertical: 'top' } : null]} multiline={big} maxLength={big ? 300 : 200} value={values[k]} onChangeText={(v) => setValues((o) => ({ ...o!, [k]: v }))} accessibilityLabel={label} />
            </View>
          )) : null}
          <ErrorText>{error}</ErrorText>
          {values ? <Button title="Save details" onPress={() => { void save(); }} busy={busy} /> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
