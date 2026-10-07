import { authApi } from '../api/resources.js';
import { setCsrf, onUnauthorized } from '../api/client.js';

/** Estado de sesión del panel. Los permisos acá solo sirven para mostrar/ocultar UI; el backend siempre decide. */
const state = { user: null, permissions: new Set() };
const subs = new Set();
const notify = () => subs.forEach((f) => f(state));

function apply(data) {
  state.user = data.user; state.permissions = new Set(data.permissions); setCsrf(data.csrfToken);
  notify();
}
export const session = {
  get user() { return state.user; },
  can: (code) => state.permissions.has(code),
  canAny: (codes) => !codes?.length || codes.some((c) => state.permissions.has(c)),
  subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  async restore() { try { apply(await authApi.me()); return true; } catch { return false; } },
  async login(email, password) { apply(await authApi.login(email, password)); },
  async logout() { try { await authApi.logout(); } finally { session.clear(); } },
  clear() { state.user = null; state.permissions = new Set(); setCsrf(null); notify(); },
  async refresh() { apply(await authApi.me()); },
};
onUnauthorized(() => { if (state.user) { session.clear(); session.expired = true; } });
