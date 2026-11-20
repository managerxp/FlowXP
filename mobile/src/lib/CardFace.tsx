import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t, fill } from './i18n.ts';
import { ICONS, type CardLook } from './cardDesign.ts';

/** The loyalty card as a customer sees it: one circle per stamp (stamp or visit cards), else the points. Same layout as the web card. */
export default function CardFace({ look, business, name, kind, balance, redeemAt }: { look: CardLook; business: string; name: string; kind: string; balance: number; redeemAt: number }) {
  const glyph = (ICONS[look.icon] ?? ICONS.star).glyph;
  const stamps = kind === 'STAMPS' || kind === 'VISITS';
  const total = Math.min(Math.max(redeemAt || 1, 1), 12);
  const filled = Math.min(balance, total);
  return (
    <View style={{ borderRadius: 16, padding: 18, backgroundColor: look.bg, gap: 12 }} accessibilityLabel={stamps ? fill(t('{n} of {total} stamps'), { n: String(filled), total: String(total) }) : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: look.fg, opacity: 0.8, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>{business}</Text>
          <Text style={{ color: look.fg, fontSize: 20, fontWeight: '700', marginTop: 4 }}>{look.title || name || t('Loyalty card')}</Text>
        </View>
        <MaterialCommunityIcons name={glyph} size={32} color={look.accent} />
      </View>
      {stamps ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center', ...(i < filled ? { backgroundColor: look.accent, borderColor: look.accent } : { borderColor: `${look.fg}88` }) }}>
              {i < filled ? <MaterialCommunityIcons name={glyph} size={18} color={look.bg} /> : <Text style={{ color: `${look.fg}aa`, fontWeight: '700', fontSize: 12 }}>{i + 1}</Text>}
            </View>
          ))}
        </View>
      ) : <Text style={{ color: look.fg, fontSize: 36, fontWeight: '700' }}>{balance} <Text style={{ fontSize: 14, fontWeight: '500' }}>{t('points')}</Text></Text>}
      {look.message ? <Text style={{ color: look.fg, backgroundColor: `${look.fg}22`, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 }}>{look.message}</Text> : null}
    </View>
  );
}
