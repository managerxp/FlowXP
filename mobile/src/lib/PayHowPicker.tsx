import { Text, TextInput, View } from 'react-native';
import { rupees } from './money.ts';
import { Button, ErrorText, Soft, color, s } from './ui.tsx';
import { t } from './i18n.ts';
import type { PayHow, PayPlan } from './billing.ts';

/* How a bill is settled: all of it now, part of it now (the rest is owed), or none of it now (the customer's credit). Used by the pharmacy and salon tills; the plan
   itself (what is allowed, how much stays due) is `payPlan` in billing.ts. */
export default function PayHowPicker({ how, onHow, nowText, onNow, plan, owes, totalPaise }: {
  how: PayHow; onHow: (h: PayHow) => void; nowText: string; onNow: (v: string) => void; plan: PayPlan; owes: string; totalPaise: number;
}) {
  const choices: { id: PayHow; label: string }[] = [{ id: 'FULL', label: t('Pay in full') }, { id: 'PART', label: t('Part payment') }, { id: 'LATER', label: t('Pay later') }];
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {choices.map((c) => <Button key={c.id} title={c.label} kind={how === c.id ? 'primary' : 'quiet'} onPress={() => onHow(c.id)} style={{ flex: 1 }} />)}
      </View>
      {how === 'PART' ? (
        <View style={{ gap: 8 }}>
          <Soft>{t('How much is being paid now?')}</Soft>
          <TextInput style={s.input} value={nowText} onChangeText={onNow} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={t('Paying now')} />
          {plan.ok ? <Text accessibilityLiveRegion="polite" style={{ color: color.warn, fontWeight: '700' }}>{t('{amount} stays due on {name}.', { amount: rupees(plan.balancePaise), name: owes })}</Text> : null}
        </View>
      ) : null}
      {how === 'LATER' ? <Text style={{ color: color.warn, fontWeight: '700' }}>{t('The whole bill, {amount}, is left unpaid on {name}.', { amount: rupees(totalPaise), name: owes })}</Text> : null}
      {how !== 'FULL' && plan.problem ? <ErrorText>{t(plan.problem)}</ErrorText> : null}
    </View>
  );
}
