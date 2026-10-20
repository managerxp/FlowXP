import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, loadMe } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { emptyOutlet, outletBody, outletForm, type Outlet, type OutletForm } from '../lib/team.ts';
import { Button, ErrorText, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const LABEL: Record<keyof OutletForm, string> = { name: 'Outlet name', code: 'Short code', city: 'City', state: 'State', phone: 'Phone', address: 'Address', pincode: 'Pincode', gstin: 'GSTIN', invoice_prefix: 'Invoice prefix', invoice_next_number: 'Next number' };
const HINT: Partial<Record<keyof OutletForm, string>> = {
  code: 'Optional', state: 'Decides GST place of supply for this outlet.', pincode: 'For GST e-invoices and e-way bills', invoice_prefix: 'Optional. Gives this outlet its own numbers (IND-0001). Empty uses the business-wide series.',
  gstin: 'Only if this outlet has its own registration.', invoice_next_number: 'Never lower than numbers already issued.'
};

/* Add an outlet, or change one's details, invoice series, or close and reopen it. The server refuses what is not allowed (the plan's outlet limit, closing the main outlet, an outlet with stock or open orders). */
export default function OutletEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [form, setForm] = useState<OutletForm>(emptyOutlet());
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get<Outlet[]>('/outlets?include_closed=true').then((list) => {
      const o = list.find((x) => x.branch_id === Number(id)) ?? null;
      setOutlet(o); if (o) setForm(outletForm(o)); setLoaded(true);
    }).catch((e: Error) => { setError(e.message); setLoaded(true); });
  }, [id]);

  const send = async (body: object, done: () => void) => {
    setBusy(true); setError('');
    try { await api.call(outlet ? `/outlets/${outlet.branch_id}` : '/outlets', { method: outlet ? 'PUT' : 'POST', body }); void loadMe(); done(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const save = () => { if (!form.name.trim()) { setError(t('Enter the outlet name.')); return; } void send(outletBody(form), () => router.back()); };
  const toggle = () => {
    if (!outlet) return;
    const closing = outlet.status === 'ACTIVE';
    Alert.alert(closing ? t('Close this outlet') : t('Reopen this outlet'), closing ? t('Closing an outlet needs its stock moved out and its open orders settled first.') : '', [
      { text: t('Cancel'), style: 'cancel' }, { text: closing ? t('Close this outlet') : t('Reopen this outlet'), style: closing ? 'destructive' : 'default', onPress: () => { void send({ status: closing ? 'CLOSED' : 'ACTIVE' }, () => router.back()); } }
    ]);
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{outlet ? outlet.name : t('Add outlet')}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!loaded ? <Loading /> : null}
          {loaded && id && !outlet ? <ErrorText>{error || t('Not found')}</ErrorText> : null}
          {loaded && (!id || outlet) ? (
            <>
              {(Object.keys(LABEL) as (keyof OutletForm)[]).filter((k) => k !== 'invoice_next_number' || form.invoice_prefix.trim()).map((k) => (
                <View key={k} style={{ gap: 4 }}>
                  <Text style={{ color: color.soft, fontSize: 13 }}>{t(LABEL[k])}</Text>
                  <TextInput style={s.input} value={form[k]} onChangeText={(v) => setForm((o) => ({ ...o, [k]: k === 'gstin' || k === 'invoice_prefix' || k === 'code' ? v.toUpperCase() : v }))}
                    keyboardType={k === 'phone' ? 'phone-pad' : k === 'pincode' || k === 'invoice_next_number' ? 'numeric' : 'default'} maxLength={k === 'pincode' ? 6 : k === 'gstin' ? 15 : k === 'code' || k === 'invoice_prefix' ? 12 : undefined}
                    autoCapitalize={k === 'name' || k === 'city' || k === 'address' || k === 'state' ? 'words' : 'none'} autoCorrect={false} accessibilityLabel={t(LABEL[k])} />
                  {HINT[k] ? <Soft>{t(HINT[k]!)}</Soft> : null}
                </View>
              ))}
              <ErrorText>{error}</ErrorText>
              <Button title={outlet ? t('Save changes') : t('Add outlet')} onPress={save} busy={busy} />
              {outlet && !outlet.is_primary ? <Button title={outlet.status === 'ACTIVE' ? t('Close this outlet') : t('Reopen this outlet')} kind={outlet.status === 'ACTIVE' ? 'danger' : 'quiet'} onPress={toggle} disabled={busy} /> : null}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
