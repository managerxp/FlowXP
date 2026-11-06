import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './index.js';

/** A product's name in the screen language when it has one (name_i18n), otherwise the name as typed. */
export const usePname = () => {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage || i18n.language;
  return useCallback((item) => (item?.name_i18n?.[lang] || item?.name || ''), [lang]);
};

/** The same without a hook, for small row components. */
export const pnameNow = (item) => item?.name_i18n?.[i18n.resolvedLanguage || i18n.language] || item?.name || '';
