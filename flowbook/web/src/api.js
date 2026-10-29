import { useCallback, useEffect, useState } from 'react';

const KEY = 'fb_token';
const safe = (fn) => { try { return fn(); } catch { return null; } };
export const getToken = () => safe(() => localStorage.getItem(KEY));
export const setToken = (t) => safe(() => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY)));

/** One call to the API. Throws an Error carrying the server's own plain message; a 401 on a signed-in session signs the person out. */
export const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const h = { ...headers };
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  if (body !== undefined) h['content-type'] = 'application/json';   // Fastify refuses an empty body that claims to be JSON
  let res;
  try { res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && t) window.dispatchEvent(new Event('fb-signout'));
    throw Object.assign(new Error(data?.error?.message || `Something went wrong (${res.status})`), { status: res.status, code: data?.error?.code });
  }
  return data;
};

/** Load something when a screen opens (and again on reload()). */
export const useLoad = (fn, deps = []) => {
  const [state, set] = useState({ data: null, error: '', loading: true });
  const run = useCallback(() => {
    set((s) => ({ ...s, loading: true, error: '' }));
    return fn().then((data) => set({ data, error: '', loading: false }), (e) => set({ data: null, error: e.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
};
