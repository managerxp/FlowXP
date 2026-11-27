import { Text, View } from 'react-native';
import { mostPoints, pointsOffPaise, type Points } from './points.ts';
import { rupees } from './money.ts';
import { t } from './i18n.ts';
import { Button, Soft, color, s, TextInput } from './ui.tsx';

/** The customer's points on the pay screen: what they have, and how many to use on this bill. */
export const PointsBox = ({ points, totalPaise, value, onChange }: { points: Points; totalPaise: number; value: string; onChange: (v: string) => void }) => {
  const can = points.balance >= points.min_redeem_points;
  const most = mostPoints(points, totalPaise);
  const off = pointsOffPaise(points, Number(value) || 0, totalPaise);
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
      <Text style={{ color: color.ink, fontWeight: '700' }}>{t('{n} points', { n: points.balance })} <Text style={{ color: color.soft, fontWeight: '400' }}>({rupees(Math.round(points.balance_value * 100))})</Text></Text>
      {can ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} value={value} onChangeText={(v) => onChange(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder={t('Points to use')} accessibilityLabel={t('Points to use')} />
          <Button title={t('Use max ({n})', { n: most })} kind="quiet" onPress={() => onChange(String(most))} disabled={most < points.min_redeem_points} />
        </View>
      ) : <Soft>{t('Needs {n} points to spend.', { n: points.min_redeem_points })}</Soft>}
      {off > 0 ? <Text style={{ color: color.ok, fontWeight: '700' }}>−{rupees(off)}</Text> : null}
    </View>
  );
};
