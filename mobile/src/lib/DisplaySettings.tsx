import { Text, View } from 'react-native';
import { Chips, Soft, color } from './ui.tsx';
import { DATE_FORMATS, DECIMALS, THEMES, formatDate, setDisplay, useDisplay, type DatePref, type DecimalsPref, type ThemePref } from './display.ts';
import { kvGet, kvSet } from './local.ts';
import { rupees } from './money.ts';
import { t } from './i18n.ts';

const kv = { get: kvGet, set: kvSet };
const THEME_TEXT: Record<ThemePref, string> = { system: 'Same as the phone', light: 'Light', dark: 'Dark' };
const DATE_TEXT: Record<DatePref, string> = { auto: 'Automatic', dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY-MM-DD' };
const DECIMAL_TEXT: Record<DecimalsPref, string> = { 0: 'No decimals', 1: 'One decimal', 2: 'Two decimals' };

/* Settings > Display: this phone's theme, date format and decimal places on amounts. Kept on the phone; a change redraws the app (app/_layout.tsx). */
export default function DisplaySettings() {
  const d = useDisplay();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Display')}</Text>
      <Soft>{t('How this phone shows the app. It stays on this phone and changes nothing on your bills or reports.')}</Soft>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Theme')}</Text>
      <Chips items={THEMES.map((x) => ({ id: x, label: THEME_TEXT[x] }))} value={d.theme} onChange={(x) => { void setDisplay({ theme: x }, kv); }} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{`${t('Date format')}: ${formatDate('2026-10-15', d.date)}`}</Text>
      <Chips items={DATE_FORMATS.map((x) => ({ id: x, label: DATE_TEXT[x] }))} value={d.date} onChange={(x) => { void setDisplay({ date: x }, kv); }} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{`${t('Amounts')}: ${rupees(123450)}`}</Text>
      <Chips items={DECIMALS.map((x) => ({ id: String(x), label: DECIMAL_TEXT[x] }))} value={String(d.decimals)} onChange={(x) => { void setDisplay({ decimals: Number(x) as DecimalsPref }, kv); }} />
      <Soft>{t('Receipts and shared bills always show the exact amount.')}</Soft>
    </View>
  );
}
