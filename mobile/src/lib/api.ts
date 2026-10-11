/*
 * The only place the app talks to the FlowXP server. Same rules as the web app's lib/api.js: the session is a Bearer token, the
 * business and outlet go as claims in headers (the server verifies them), and a sale carries an Idempotency-Key so a retry after a
 * dropped connection returns the same invoice instead of billing twice.
 */

export class ApiError extends Error {
  status: number; code?: string; data?: unknown;
  constructor(message: string, status: number, code?: string, data?: unknown) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.data = data; }
}

/** No answer at all (offline, server unreachable). A TypeError on purpose, like the web app: callers that retry with the same key key off this. */
export class NetworkError extends TypeError {
  constructor() { super("You're offline, or the server can't be reached. Check the connection and try again."); this.name = 'NetworkError'; }
}

export type Session = { token: string | null; businessId: number | null; branchId: number | null };
export type Envelope<T> = { success: boolean; data: T; message?: string; code?: string; meta?: Record<string, unknown> };

export type ApiOptions = { baseUrl: string; getSession: () => Session; onToken?: (token: string) => void; onUnauthorized?: () => void; fetchImpl?: typeof fetch };
export type CallOptions = { method?: string; body?: unknown; idempotencyKey?: string; businessId?: number | null; signIn?: boolean; timeoutMs?: number; headers?: Record<string, string> };

/** A new id for one user action (one sale). Random enough that two phones never collide; the server keeps it per business. */
export const newKey = (): string => {
  const chunk = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `m-${Date.now().toString(36)}-${chunk()}${chunk()}${chunk()}`;
};

export const createApi = ({ baseUrl, getSession, onToken, onUnauthorized, fetchImpl }: ApiOptions) => {
  const call = async <T>(path: string, { method = 'GET', body, idempotencyKey, businessId, signIn = false, timeoutMs = 30000, headers: extra }: CallOptions = {}): Promise<Envelope<T>> => {
    const session = getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'FlowXP' };
    if (session.token) headers.Authorization = `Bearer ${session.token}`;
    const business = businessId ?? session.businessId;
    if (business != null) headers['X-Business-Id'] = String(business);
    if (session.branchId != null) headers['X-Branch-Id'] = String(session.branchId);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (extra) Object.assign(headers, extra);

    // a signal so weak the request hangs is the same as no signal: give up after timeoutMs (a till must not freeze on a bad connection)
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal });
    } catch { throw new NetworkError(); } finally { clearTimeout(timer); }

    let json: Envelope<T> | null = null;
    try { json = (await response.json()) as Envelope<T>; } catch { /* not JSON: a proxy error page */ }
    if (!response.ok || !json || json.success === false) {
      // a wrong password is a 401 too, and must say so rather than sign the person out
      if (response.status === 401 && !signIn) onUnauthorized?.();
      throw new ApiError(json?.message || `The server answered ${response.status}`, response.status, json?.code, json?.data);
    }
    return json;
  };

  return {
    call,
    get: async <T>(path: string, options?: CallOptions) => (await call<T>(path, options)).data,
    post: async <T>(path: string, body: unknown, options?: CallOptions) => (await call<T>(path, { ...options, method: 'POST', body })).data,
    /** The session slides forward: the server hands a Bearer caller a fresh token on /auth/me. */
    refreshSession: async () => {
      const me = await call<{ token?: string }>('/auth/me');
      if (me.data?.token) onToken?.(me.data.token);
      return me.data;
    }
  };
};

export type Api = ReturnType<typeof createApi>;
