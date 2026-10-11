import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, useSession } from './session.ts';
import { kvGet, kvSet } from './local.ts';
import { dayOf } from './till.ts';
import type { FLine } from './field.ts';
import { hints, keepSchemes, keptText, parseKept, schemeKey, type Kept } from './schemeHints.ts';
import { SectionTitle, Soft, color } from './ui.tsx';
import { t } from './i18n.ts';

/* The offers the shop in front of the rep qualifies for, and how far this order is from each. Read from the phone when there is no signal (the list kept when it was last online);
   with a signal it is refreshed first. FlowXP works out the real discount when the order is sent. */
export const Offers = ({ customerId, lines }: { customerId: number | null; lines: FLine[] }) => {
  const session = useSession();
  const [kept, setKept] = useState<Kept | null>(null);
  const [fresh, setFresh] = useState(false);
  const today = dayOf(Date.now());

  useEffect(() => {
    if (customerId == null) { setKept(null); return; }
    let alive = true;
    void kvGet(schemeKey(session.businessId, customerId)).then((raw) => { if (alive) setKept(parseKept(raw)); });
    void keepSchemes(api, { get: kvGet, set: kvSet }, session.businessId, customerId, today).then((k) => { if (alive && k) { setKept(k); setFresh(true); } });
    return () => { alive = false; };
  }, [customerId, session.businessId, today]);

  const list = kept ? hints(kept.schemes, lines, today) : [];
  if (!kept) return null;
  return (
    <View>
      <SectionTitle>Offers for this shop</SectionTitle>
      {list.length === 0 ? <Soft style={{ paddingHorizontal: 16 }}>No offer is running for this shop.</Soft> : null}
      {list.map((h) => (
        <View key={h.scheme.scheme_id} style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-start' }}>
          <Ionicons name={h.reached ? 'checkmark-circle' : 'pricetag-outline'} size={22} color={h.reached ? color.ok : color.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: h.reached ? color.ok : color.ink, fontWeight: '600' }}>{h.scheme.name}</Text>
            <Text style={{ color: color.soft, fontSize: 14 }}>{h.text}</Text>
          </View>
        </View>
      ))}
      {!fresh ? <Soft style={{ paddingHorizontal: 16 }}>{t('No internet. Offers as they were {when}.', { when: keptText(kept.at) })}</Soft> : null}
    </View>
  );
};
