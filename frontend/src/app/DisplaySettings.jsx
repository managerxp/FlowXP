/*
 * Settings → Business → Display: how this device shows the app: theme, date format and decimal places on amounts (lib/display.js). A person's own
 * preference for the screen in front of them, kept in this browser; it changes nothing that is stored or printed.
 */
import { useState } from 'react';
import { Card, Field, Select } from '../components/ui.jsx';
import { DATE_FORMATS, DECIMALS, THEMES, formatDate, getDisplay, setDisplay } from '../lib/display.js';
import { useT, T } from '../i18n/useT.js';

const THEME_TEXT = { system: T('Same as my device'), light: T('Light'), dark: T('Dark') };
const DATE_TEXT = { auto: T('Automatic'), dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY-MM-DD' };
const DECIMAL_TEXT = { 0: T('No decimals (₹1,234)'), 1: T('One decimal (₹1,234.5)'), 2: T('Two decimals (₹1,234.50)') };

export default function DisplaySettings() {
  const tr = useT();
  const [prefs, setPrefs] = useState(getDisplay);
  // the theme changes at once; a date or decimals change is picked up by every screen when the page reloads
  const change = (patch) => {
    setDisplay(patch); setPrefs({ ...getDisplay() });
    if ('date' in patch || 'decimals' in patch) window.location.reload();
  };
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Display')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('How this device shows the app. It is kept in this browser only and changes nothing on your bills or reports.')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field id="disp_theme" label={tr('Theme')}>
          <Select id="disp_theme" value={prefs.theme} onChange={(e) => change({ theme: e.target.value })}>
            {THEMES.map((t) => <option key={t} value={t}>{tr(THEME_TEXT[t])}</option>)}
          </Select>
        </Field>
        <Field id="disp_date" label={tr('Date format')} hint={formatDate(new Date())}>
          <Select id="disp_date" value={prefs.date} onChange={(e) => change({ date: e.target.value })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f === 'auto' ? tr(DATE_TEXT[f]) : DATE_TEXT[f]}</option>)}
          </Select>
        </Field>
        <Field id="disp_dec" label={tr('Amounts')}>
          <Select id="disp_dec" value={prefs.decimals} onChange={(e) => change({ decimals: Number(e.target.value) })}>
            {DECIMALS.map((n) => <option key={n} value={n}>{tr(DECIMAL_TEXT[n])}</option>)}
          </Select>
        </Field>
      </div>
      <label className="mt-4 flex items-start gap-2.5 text-sm text-ink-700">
        <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={prefs.showProfit === true} onChange={(e) => change({ showProfit: e.target.checked })} />
        <span>{tr('Show the profit on the bill while billing')}<span className="block text-caption text-ink-500">{tr('Only for people who can see reports, and only where the cost of the items is known.')}</span></span>
      </label>
    </Card>
  );
}
