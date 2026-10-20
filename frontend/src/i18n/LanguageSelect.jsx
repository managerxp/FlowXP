/* A language picker: a native select (keyboard and screen-reader friendly), each language written in itself with its language tag, never a flag. */
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './config.js';
import { useLanguage } from './LanguageSync.jsx';

const LanguageSelect = ({ className = '', compact = false }) => {
  const { t } = useTranslation('common');
  const { lang, choose } = useLanguage();
  return (
    <label className={`inline-flex items-center gap-2 text-sm text-ink-700 ${className}`}>
      <span className={compact ? 'sr-only' : 'font-medium'}>{t('language.label')}</span>
      <select
        value={lang}
        onChange={(e) => { void choose(e.target.value); }}
        aria-label={t('language.label')}
        className="h-9 max-w-[11rem] rounded-lg border border-line bg-surface px-2.5 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>{l.name}{l.code !== 'en' ? ` · ${l.english}` : ''}</option>
        ))}
      </select>
    </label>
  );
};

export default LanguageSelect;
