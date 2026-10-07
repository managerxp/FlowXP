import { useEffect, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { setCustomer } from '../lib/sale.ts';
import type { Customer } from '../lib/types.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

/* Customers. Opened from More it is the list; opened from the bill (pick) a tap puts that customer on the bill and closes. */
export default function Customers() {
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const session = useSession();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [pickError, setPickError] = useState('');
  const scope = useScope();
  const [local, setLocal] = useState<Customer[]>([]);
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const { data, savedAt, error, busy, refresh } = useLoad<Customer[]>(`customers:${session.businessId}:${search}`, () => api.get<Customer[]>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`));

  // with no internet (nothing from the server and nothing saved for this search) the phone's own copy of the customers answers
  const offline = Boolean(error && !data);
  useEffect(() => {
    if (!offline || !scope) { setLocal([]); return; }
    let alive = true;
    void scope.catalog.customers(search).then((rows) => { if (alive) setLocal(rows.map((r) => ({ ...r, address: null, credit_limit: 0, outstanding_balance: 0, total_purchases: 0, bills: 0, first_bill_date: null, last_bill_date: null, status: 'ACTIVE' }))); });
    return () => { alive = false; };
  }, [offline, scope, search]);
  const rows = offline ? local : (data ?? []);

  const choose = async (c: Customer) => {
    if (pick?.startsWith('order-')) {
      // a customer for a table's order: the order carries them to the bill
      try { await api.call(`/orders/${pick.slice(6)}/customer`, { method: 'PATCH', body: { customer_id: c.customer_id } }); goBack(); }
      catch (e) { setPickError(e instanceof Error ? e.message : 'Could not set the customer'); }
      return;
    }
    if (pick) { setCustomer({ id: c.customer_id, name: c.name, phone: c.phone }); goBack(); }
    else router.push({ pathname: '/customer/[id]', params: { id: String(c.customer_id) } });
  };

  if (adding) return <AddCustomer onDone={(c) => { setAdding(false); void refresh(); if (c && pick) void choose(c); }} />;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title>{pick ? 'Choose a customer' : 'Customers'}</Title>
            <Button title="Back" kind="quiet" onPress={() => goBack()} />
          </View>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search by name or phone" autoCorrect={false} accessibilityLabel="Search customers" />
          <Button title="Add customer" kind="quiet" onPress={() => setAdding(true)} />
        </View>
        <SavedNote at={savedAt} />
        {offline && local.length === 0 ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}
        {offline && local.length > 0 ? <Text style={{ color: color.warn, paddingHorizontal: 16, paddingBottom: 6 }}>No internet. Showing the customers saved on this phone.</Text> : null}
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{pickError}</ErrorText></View>
        <FlatList
          style={{ flex: 1 }} data={rows} keyExtractor={(c) => String(c.customer_id)} keyboardShouldPersistTaps="handled" refreshing={busy} onRefresh={() => { void refresh(); }}
          ListEmptyComponent={busy ? <Loading what="Loading customers" /> : <Empty>{search ? 'No customer matches.' : 'No customers yet.'}</Empty>}
          renderItem={({ item: c }) => (
            <Line left={c.name} right={c.outstanding_balance > 0 ? `Owes ${rupees(toPaise(c.outstanding_balance))}` : undefined} sub={[c.phone, offline ? null : c.bills ? `${c.bills} bills` : 'New'].filter(Boolean).join(' · ')} onPress={() => { void choose(c); }} />
          )}
        />
      </Page>
    </SafeAreaView>
  );
}

const AddCustomer = ({ onDone }: { onDone: (c?: Customer) => void }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(newKey());

  const save = async () => {
    if (!name.trim()) return setError('Enter the name');
    setBusy(true); setError('');
    try {
      const made = await api.post<Customer>('/customers', { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}) }, { idempotencyKey: key });
      onDone(made);
    } catch (e) { setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Title>New customer</Title>
          <Soft>A phone number lets the visit card and their bills find them next time.</Soft>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name" accessibilityLabel="Name" autoFocus />
          <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="Mobile number" keyboardType="phone-pad" accessibilityLabel="Mobile number" />
          <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Email (optional)" keyboardType="email-address" autoCapitalize="none" accessibilityLabel="Email" />
          <ErrorText>{error}</ErrorText>
          <Button title="Save customer" onPress={save} busy={busy} />
          <Button title="Cancel" kind="quiet" onPress={() => onDone()} disabled={busy} />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
};
