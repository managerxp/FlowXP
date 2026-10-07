/*
 * Show the last answer at once, then refresh it ("stale while revalidate"): a screen that was open a minute ago opens with its
 * figures already on it instead of a blank, and they change when the new answer arrives. The kept copy lives in this browser
 * tab (sessionStorage), under the business and outlet being viewed, so one business's figures are never shown for another.
 *
 *   const { data, reload } = useSwr('/retail/summary', `${business.business_id}-${outletId}`);
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const read = (k) => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : undefined; } catch { return undefined; } };
const write = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: no kept copy, still works */ } };

export const useSwr = (path, scope = '') => {
  const key = `swr:${scope}:${path}`;
  const [data, setData] = useState(() => read(key));
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    return api(path).then((d) => { if (mine === seq.current) { setData(d); write(key, d); } return d; }).catch(() => undefined);
  }, [path, key]);
  useEffect(() => { setData(read(key)); reload(); return () => { seq.current++; }; }, [key, reload]);
  return { data, reload };
};
