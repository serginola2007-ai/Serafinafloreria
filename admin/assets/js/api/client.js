/** Cliente HTTP único del panel. Mismo origen que el backend; la sesión viaja en cookie HttpOnly (el JS no la ve). */
export class ApiError extends Error {
  constructor(status, body) {
    const e = body?.error;
    super(e?.message || (status === 0 ? 'No hay conexión con el servidor' : `Error ${status}`));
    this.status = status; this.code = e?.code || (status === 0 ? 'NETWORK' : 'ERROR');
    this.details = e?.details; this.requestId = e?.requestId;
  }
}

let csrfToken = null;
export const setCsrf = (t) => { csrfToken = t; };
const unauthorizedHandlers = new Set();
export const onUnauthorized = (fn) => unauthorizedHandlers.add(fn);

function qs(query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function request(method, path, { query, body, form, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const opts = { method, headers, credentials: 'same-origin', signal };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (form) opts.body = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api/v1${path}${qs(query)}`, opts); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, null); }
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch { /* cuerpo vacío o no JSON */ } }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith('/auth/login')) unauthorizedHandlers.forEach((fn) => fn(err));
    throw err;
  }
  return data;
}
export const get = (p, query, o) => request('GET', p, { query, ...o });
export const post = (p, body, o) => request('POST', p, { body, ...o });
export const put = (p, body) => request('PUT', p, { body });
export const patch = (p, body) => request('PATCH', p, { body });
export const del = (p) => request('DELETE', p);
