import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { setCustomer, useSale } from '../lib/sale.ts';
import { useLoad } from '../lib/useLoad.ts';
import { bookBody, bookProblem, dayChoices, freeAt, slotStart, totalMinutes, type Appointment, type Availability, type SalonCatalog } from '../lib/salon.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Book an appointment (or, opened with move=<id>, move one): the client, the services, a day, then a time that is really free. The server checks again when you book. */
export default function NewAppointment() {
  const { move } = useLocalSearchParams<{ move?: string }>();
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const { customer } = useSale();
  const catalog = useLoad<SalonCatalog>(`salon-catalog:${scope}`, () => api.get<SalonCatalog>('/salon/pos/catalog'));
  const existing = useLoad<Appointment>(`appointment:${move}`, () => api.get<Appointment>(`/salon/appointments/${move}`), Boolean(move));
  const days = dayChoices();
  const [date, setDate] = useState(days[0].id);
  const [picked, setPicked] = useState<number[]>([]);
  const [guest, setGuest] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [staffId, setStaffId] = useState('0');
  const [time, setTime] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey());   // one key for this booking: a double tap books once
  const cat = catalog.data;
  const serviceIds = move ? (existing.data?.services.map((x) => x.service_id) ?? []) : picked;

  useEffect(() => { if (!move) setCustomer(null); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // free times for these services on this day
  useEffect(() => {
    if (!serviceIds.length) { setAvail(null); return; }
    let live = true; setLooking(true); setTime(null);
    const t = setTimeout(() => {
      void api.get<Availability>(`/salon/availability?date=${date}&service_ids=${serviceIds.join(',')}${staffId !== '0' ? `&staff_id=${staffId}` : ''}`)
        .then((a) => { if (live) { setAvail(a); setProblem(''); } }).catch((e: Error) => { if (live) { setAvail(null); setProblem(e.message); } }).finally(() => { if (live) setLooking(false); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [date, serviceIds.join(','), staffId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number) => { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setTime(null); };

  const save = async () => {
    const bad = move ? (time ? '' : 'Choose a time') : bookProblem(customer?.id ?? null, guest, serviceIds, time);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const start = slotStart(date, time!);
      if (move) await api.call(`/salon/appointments/${move}`, { method: 'PUT', body: { start_at: start } });
      else await api.post('/salon/appointments', bookBody({ customerId: customer?.id ?? null, guestName: guest, guestPhone: phone, startIso: start, serviceIds, staffId: staffId === '0' ? null : Number(staffId), notes }), { idempotencyKey: key });
      setCustomer(null);
      router.replace('/appointments');
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not book'); }
    finally { setBusy(false); }
  };

  const mins = cat ? totalMinutes(cat, serviceIds) : 0;
  const total = cat ? serviceIds.reduce((a, id) => a + toPaise(cat.services.find((x) => x.service_id === id)?.price ?? 0), 0) : 0;
  const who = freeAt(avail?.slots ?? [], time);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{move ? 'Move appointment' : 'Book an appointment'}</Title>{move && existing.data ? <Soft>{`${existing.data.customer_name ?? 'Walk-in'} · ${existing.data.services.map((x) => x.name).join(', ')}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          {!move ? (
            <>
              <SectionTitle>Client</SectionTitle>
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {customer ? <Text style={{ fontSize: 16, color: color.ink }}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</Text> : (
                  <>
                    <TextInput style={s.input} value={guest} onChangeText={setGuest} placeholder="New guest name" accessibilityLabel="Guest name" />
                    <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Mobile number (optional)" accessibilityLabel="Mobile number" />
                  </>
                )}
                <Button title={customer ? 'Change client' : 'Choose an existing client'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} />
              </View>
              <SectionTitle>Services</SectionTitle>
              {catalog.busy && !cat ? <Loading /> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                {(cat?.services ?? []).map((x) => (
                  <Button key={x.service_id} title={`${x.name} · ${x.duration_min} min`} kind={picked.includes(x.service_id) ? 'primary' : 'quiet'} onPress={() => toggle(x.service_id)} />
                ))}
              </View>
              {picked.length ? <Soft style={{ padding: 16 }}>{`${mins} minutes · ${rupees(total)} before GST`}</Soft> : null}
            </>
          ) : null}

          <SectionTitle>Day</SectionTitle>
          <Chips items={days} value={date} onChange={(d) => { setDate(d); setTime(null); }} />
          {cat && cat.staff.length > 0 ? (
            <>
              <SectionTitle>Team member</SectionTitle>
              <Chips items={[{ id: '0', label: 'Anyone free' }, ...cat.staff.map((x) => ({ id: String(x.staff_id), label: x.name }))]} value={staffId} onChange={setStaffId} />
            </>
          ) : null}

          <SectionTitle>Time</SectionTitle>
          {looking ? <Loading what="Finding free times" /> : null}
          {!looking && serviceIds.length === 0 ? <Empty>Choose a service to see free times.</Empty> : null}
          {!looking && avail && avail.slots.length === 0 ? <Empty>Nobody is free on this day for these services. Try another day or team member.</Empty> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
            {(avail?.slots ?? []).map((sl) => <Button key={sl.time} title={sl.time} kind={time === sl.time ? 'primary' : 'quiet'} onPress={() => setTime(sl.time)} />)}
          </View>
          {time && who.length ? <Soft style={{ padding: 16 }}>{`Free at ${time}: ${who.map((w) => w.name).join(', ')}`}</Soft> : null}

          {!move ? <View style={{ padding: 16 }}><TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" /></View> : null}
          <View style={{ padding: 16, gap: 8 }}>
            <ErrorText>{problem}</ErrorText>
            <Button title={move ? 'Move it' : 'Book it'} onPress={() => { void save(); }} busy={busy} disabled={!time} />
          </View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
