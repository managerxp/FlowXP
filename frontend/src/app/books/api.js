import { useCallback, useEffect, useState } from 'react';
/* FlowBook is part of the FlowXP app: the person is already signed in to FlowXP (a cookie the browser sends on its own), and the business
   is the one FlowXP is working in. There is no FlowBook sign-in and no token of its own. */
import { APP_HEADER, getBusinessId } from '../../lib/api.js';

const ROOT = '/api/books/v1';

/** One call to the API. Throws an Error carrying the server's own plain message. FlowBook answers { error: { code, message } }; FlowXP's own checks in front of it answer { message }. */
export const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const h = { ...APP_HEADER, ...headers };
  const business = getBusinessId();
  if (business) h['X-Business-Id'] = business;
  if (body !== undefined) h['content-type'] = 'application/json';   // Fastify refuses an empty body that claims to be JSON
  let res;
  try { res = await fetch(`${ROOT}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.location.assign('/login?next=%2Fapp%2Fbooks');
    throw Object.assign(new Error(data?.error?.message || data?.message || `Something went wrong (${res.status})`), { status: res.status, code: data?.error?.code || data?.code });
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
