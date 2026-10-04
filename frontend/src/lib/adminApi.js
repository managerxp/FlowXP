/*
 * The super admin API client — a small parallel to lib/api.js, not a
 * refactor of it.
 *
 * Kept separate deliberately: a super admin session and a business-owner
 * session are different tokens that must be able to coexist in the same
 * browser (testing the admin console and the product side by side is
 * exactly what this exists for), so this uses its own localStorage key
 * rather than sharing lib/api.js's `flowxp.token`. It also never sends
 * X-Business-Id — every /api/admin/* route is platform-wide, not scoped to
 * one tenant.
 */

const ADMIN_TOKEN_KEY = 'flowxp.admin.token';

export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY);
export const setAdminToken = (token) => localStorage.setItem(ADMIN_TOKEN_KEY, token);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_TOKEN_KEY);

export class AdminApiError extends Error {
  constructor(message, status, payload = {}) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.payload = payload;   // the whole body, e.g. { requires_2fa: true } on a sign-in that still needs its code
  }
}

/** `root` points a call at another part of the API the console also uses (the account's own /api/auth routes). */
export const adminApi = async (path, { method = 'GET', body, root = '/api/admin' } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${root}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // a 401 on the sign-in itself (a wrong password, or a code still to give) is not an expired session
    if (response.status === 401 && !payload.requires_2fa && !path.startsWith('/login')) clearAdminToken();
    throw new AdminApiError(payload.message || 'Something went wrong', response.status, payload);
  }

  return payload.data ?? payload;
};
